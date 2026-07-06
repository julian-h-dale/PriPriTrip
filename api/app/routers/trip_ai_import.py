"""AI-assisted trip import.

Two separate passes, each its own endpoint:
  - POST /trip/ai-import  : structure a document into a draft TripImport.
  - POST /trip/ai-enhance : enrich an existing trip's descriptions.

Neither endpoint persists anything; the frontend saves via POST /trip/import.
"""

import logging
import time

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.auth import require_auth
from app.models import UserRecord
from app.schemas import TripImport
from app.services import document_ingest, trip_ai

logger = logging.getLogger("app.ai_import")

router = APIRouter(tags=["import"])

_MAX_BYTES = 15 * 1024 * 1024  # 15 MB


@router.post("/trip/ai-import", response_model=TripImport)
async def ai_import(
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_auth),
):
    started = time.monotonic()
    filename = file.filename or "unknown"
    logger.info("ai-import start: user=%s file=%s", getattr(user, "id", "?"), filename)

    data = await file.read()
    logger.info("ai-import read %d bytes from %s", len(data), filename)
    if len(data) > _MAX_BYTES:
        logger.warning("ai-import rejected %s: %d bytes exceeds limit", filename, len(data))
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File is too large (max 15 MB).",
        )

    document_text = document_ingest.extract_text(filename, data)
    logger.info("ai-import extracted %d chars of text from %s", len(document_text), filename)

    # The OpenAI client is synchronous/blocking; run it off the event loop so it
    # does not stall the whole server while waiting on the API.
    try:
        draft = await run_in_threadpool(trip_ai.structure_document, document_text)
    except HTTPException:
        raise
    except Exception:
        logger.exception("ai-import failed during structure pass for %s", filename)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI import failed. See server logs for details.",
        )

    elapsed = time.monotonic() - started
    logger.info(
        "ai-import done: file=%s trip=%r days=%d in %.1fs",
        filename,
        draft.tripName,
        len(draft.days),
        elapsed,
    )
    return draft


@router.post("/trip/ai-enhance", response_model=TripImport)
async def ai_enhance(
    trip: TripImport,
    user: UserRecord = Depends(require_auth),
):
    """Pass 2: enhance an existing trip's descriptions, preserving all IDs."""
    started = time.monotonic()
    logger.info(
        "ai-enhance start: user=%s trip=%r days=%d",
        getattr(user, "id", "?"), trip.tripName, len(trip.days),
    )

    try:
        enhanced = await run_in_threadpool(trip_ai.enhance_trip_import, trip)
    except HTTPException:
        raise
    except Exception:
        logger.exception("ai-enhance failed for trip=%r", trip.tripName)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI enhance failed. See server logs for details.",
        )

    elapsed = time.monotonic() - started
    logger.info(
        "ai-enhance done: trip=%r days=%d in %.1fs",
        enhanced.tripName, len(enhanced.days), elapsed,
    )
    return enhanced

