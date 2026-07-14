"""AI-assisted trip import.

Trip-scoped endpoints:
  - POST /trips/ai-import               : structure a document into a new draft TripImport.
  - POST /trips/{trip_id}/ai-import     : same, for an existing trip (records the document).
  - POST /trips/ai-enhance              : enrich a draft trip's descriptions.
  - POST /trips/{trip_id}/ai-documents  : extract stay/travel records from a document.

Document-scoped endpoints:
  - POST /ai-documents/{document_id}/save   : persist the extracted records.

The list/re-read/regen endpoints are gone with the document-importer and review
screens they served (docs/document_plan_july_13.md): a confirmation uploaded in
the chat is extracted and saved in one go, so there is nothing to come back to.
AIDocumentRecord itself stays — its content_hash is what detects a re-upload of
the same file, and it backs the itinerary-reimport guard.

Draft structuring persists nothing; the frontend saves via POST /trips/{trip_id}/import.
"""

import logging
import time

import hashlib
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.dependencies import get_owned_trip, require_owned_trip
from app.enums import AIDocumentType, AIDocumentWorkflowMode
from app.models import AIDocumentRecord, StayDetailRecord, TravelDetailRecord, TripRecord, UserRecord
from app.schemas import AIDocumentExtraction, AIDocumentSaveRequest, AIDocumentSaveResult, TripImport
from app.services import document_ingest, trip_ai
from app.services import trip_write
from app.services.trip_state import promote_to_draft

logger = logging.getLogger("app.ai_import")

router = APIRouter(tags=["import"])

_MAX_BYTES = 15 * 1024 * 1024  # 15 MB


def _remint_record_ids(payload: AIDocumentExtraction) -> None:
    """Give a reused extraction fresh record ids.

    The content-hash cache lets a document extracted once be reused on another
    trip without paying for a second OpenAI call. But the extraction it copies
    carries the record ids minted for the *original* trip, and those rows exist.
    A stay keeping its old stayDetailId is a stay that already exists, so the
    save skips it — the same hotel confirmation uploaded to a second trip
    imported nothing at all and reported "0 stay records".

    The extracted *content* is what's worth caching. The identities are not.
    """
    for stay in payload.stays:
        stay.stay_detail_id = str(uuid.uuid4())
        for location in stay.locations:
            location.location_id = str(uuid.uuid4())
    for travel in payload.travels:
        travel.travel_detail_id = str(uuid.uuid4())
        for location in travel.locations:
            location.location_id = str(uuid.uuid4())


def _document_payload(rec: AIDocumentRecord) -> AIDocumentExtraction:
    payload = AIDocumentExtraction.model_validate_json(rec.extracted_payload)
    payload.document_id = rec.document_id
    payload.trip_id = rec.trip_id
    payload.filename = rec.filename
    payload.document_type = AIDocumentType(getattr(rec, "document_type", AIDocumentType.DETAIL.value))
    payload.workflow_mode = AIDocumentWorkflowMode(getattr(rec, "workflow_mode", AIDocumentWorkflowMode.DETAIL_IMPORT.value))
    return payload


def _itinerary_reimport_detail(*, trip: TripRecord) -> dict:
    return {
        "errorCode": "ITINERARY_REIMPORT_BLOCKED",
        "tripId": trip.trip_id,
        "existingStatus": trip.status,
        "nextAllowedActions": ["go_to_inspection", "upload_detail_document"],
    }


def _itinerary_doc_locked(trip: TripRecord) -> bool:
    return trip.status != "new"


@router.post("/trips/ai-import", response_model=TripImport)
async def ai_import_new_trip(
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_auth),
):
    """Structure a document into a brand-new draft trip (nothing persisted)."""
    return await _ai_import(file=file, trip=None, db=None, user=user)


@router.post("/trips/{trip_id}/ai-import", response_model=TripImport)
async def ai_import_for_trip(
    file: UploadFile = File(...),
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    """Structure an itinerary document for an existing trip and record the document."""
    return await _ai_import(file=file, trip=trip, db=db, user=user)


async def _ai_import(
    *,
    file: UploadFile,
    trip: TripRecord | None,
    db: AsyncSession | None,
    user: UserRecord,
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

    if trip is not None and _itinerary_doc_locked(trip):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_itinerary_reimport_detail(trip=trip),
        )

    if trip is None:
        document_text = document_ingest.extract_text(filename, data)
        logger.info("ai-import extracted %d chars of text from %s", len(document_text), filename)
        try:
            draft = await trip_ai.structure_document(document_text)
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
            draft.trip_name,
            len(draft.days),
            elapsed,
        )
        return draft

    content_hash = hashlib.sha256(data).hexdigest()

    global_cached_result = await db.execute(
        select(AIDocumentRecord)
        .where(
            AIDocumentRecord.content_hash == content_hash,
            AIDocumentRecord.document_type == AIDocumentType.ITINERARY.value,
            AIDocumentRecord.workflow_mode == AIDocumentWorkflowMode.ITINERARY_IMPORT.value,
            AIDocumentRecord.trip_import_payload.is_not(None),
        )
        .order_by(AIDocumentRecord.updated_at.desc(), AIDocumentRecord.created_at.desc())
        .limit(1)
    )
    global_cached_doc = global_cached_result.scalar_one_or_none()

    if global_cached_doc is not None and global_cached_doc.trip_import_payload:
        draft = TripImport.model_validate_json(global_cached_doc.trip_import_payload)
        document_text = global_cached_doc.body_contents
    else:
        document_text = document_ingest.extract_text(filename, data)
        logger.info("ai-import extracted %d chars of text from %s", len(document_text), filename)

        try:
            draft = await trip_ai.structure_document(document_text)
        except HTTPException:
            raise
        except Exception:
            logger.exception("ai-import failed during structure pass for %s", filename)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="AI import failed. See server logs for details.",
            )

    draft = draft.model_copy(update={"trip_id": trip.trip_id})

    if trip is not None:
        doc_id = str(uuid.uuid4())
        itinerary_payload = AIDocumentExtraction(
            documentId=doc_id,
            tripId=trip.trip_id,
            filename=filename,
            documentType=AIDocumentType.ITINERARY,
            workflowMode=AIDocumentWorkflowMode.ITINERARY_IMPORT,
            cached=global_cached_doc is not None,
            stays=draft.stays,
            travels=draft.travels,
        )
        db.add(
            AIDocumentRecord(
                document_id=doc_id,
                user_id=str(user.id),
                trip_id=trip.trip_id,
                filename=filename,
                document_type=AIDocumentType.ITINERARY.value,
                workflow_mode=AIDocumentWorkflowMode.ITINERARY_IMPORT.value,
                content_hash=content_hash,
                body_contents=document_text,
                extracted_payload=itinerary_payload.model_dump_json(by_alias=True),
                trip_import_payload=draft.model_dump_json(by_alias=True),
            )
        )
        promote_to_draft(trip)
        await db.commit()

    elapsed = time.monotonic() - started
    logger.info(
        "ai-import done: file=%s trip=%r days=%d in %.1fs",
        filename,
        draft.trip_name,
        len(draft.days),
        elapsed,
    )
    return draft


@router.post("/trips/ai-enhance", response_model=TripImport)
async def ai_enhance(
    trip: TripImport,
    user: UserRecord = Depends(require_auth),
):
    """Pass 2: enhance an existing trip's descriptions, preserving all IDs."""
    started = time.monotonic()
    logger.info(
        "ai-enhance start: user=%s trip=%r days=%d",
        getattr(user, "id", "?"), trip.trip_name, len(trip.days),
    )

    try:
        enhanced = await trip_ai.enhance_trip_import(trip)
    except HTTPException:
        raise
    except Exception:
        logger.exception("ai-enhance failed for trip=%r", trip.trip_name)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI enhance failed. See server logs for details.",
        )

    elapsed = time.monotonic() - started
    logger.info(
        "ai-enhance done: trip=%r days=%d in %.1fs",
        enhanced.trip_name, len(enhanced.days), elapsed,
    )
    return enhanced


@router.post("/trips/{trip_id}/ai-documents", response_model=AIDocumentExtraction)
async def ai_document_import(
    workflowMode: AIDocumentWorkflowMode = Form(AIDocumentWorkflowMode.DETAIL_IMPORT),
    file: UploadFile = File(...),
    tripId: str | None = Form(None),  # accepted for backwards compatibility; the path wins
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    started = time.monotonic()
    filename = file.filename or "unknown"
    tripId = trip.trip_id

    if workflowMode == AIDocumentWorkflowMode.ITINERARY_IMPORT and _itinerary_doc_locked(trip):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_itinerary_reimport_detail(trip=trip),
        )

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File is too large (max 15 MB).",
        )
    content_hash = hashlib.sha256(data).hexdigest()
    document_type = (
        AIDocumentType.ITINERARY
        if workflowMode == AIDocumentWorkflowMode.ITINERARY_IMPORT
        else AIDocumentType.DETAIL
    )

    cached_result = await db.execute(
        select(AIDocumentRecord).where(
            AIDocumentRecord.user_id == str(user.id),
            AIDocumentRecord.trip_id == tripId,
            AIDocumentRecord.content_hash == content_hash,
            AIDocumentRecord.document_type == document_type.value,
        )
    )
    cached_doc = cached_result.scalar_one_or_none()
    if cached_doc is not None and cached_doc.extracted_payload:
        payload = AIDocumentExtraction.model_validate_json(cached_doc.extracted_payload)
        payload.cached = True
        payload.document_id = cached_doc.document_id
        payload.trip_id = tripId
        payload.filename = filename
        payload.document_type = AIDocumentType(getattr(cached_doc, "document_type", document_type.value))
        payload.workflow_mode = AIDocumentWorkflowMode(getattr(cached_doc, "workflow_mode", workflowMode.value))
        cached_doc.document_type = payload.document_type.value
        cached_doc.workflow_mode = payload.workflow_mode.value
        if workflowMode == AIDocumentWorkflowMode.ITINERARY_IMPORT:
            promote_to_draft(trip)
        await db.commit()
        return payload

    global_cached_result = await db.execute(
        select(AIDocumentRecord)
        .where(
            AIDocumentRecord.content_hash == content_hash,
            AIDocumentRecord.document_type == document_type.value,
            AIDocumentRecord.extracted_payload.is_not(None),
        )
        .order_by(AIDocumentRecord.updated_at.desc(), AIDocumentRecord.created_at.desc())
        .limit(1)
    )
    global_cached_doc = global_cached_result.scalar_one_or_none()
    if global_cached_doc is not None and global_cached_doc.extracted_payload:
        document_id = str(uuid.uuid4())
        payload = AIDocumentExtraction.model_validate_json(global_cached_doc.extracted_payload)
        payload.document_id = document_id
        payload.trip_id = tripId
        payload.filename = filename
        payload.cached = True
        payload.document_type = document_type
        payload.workflow_mode = workflowMode
        # The cached payload was extracted for a *different* trip, and it still
        # carries that trip's stayDetailId/travelDetailId. Reused as-is, the save
        # step finds those ids already in the database and skips every record —
        # so uploading the same hotel confirmation to a second trip imported
        # absolutely nothing, silently, and told you "0 stay records".
        _remint_record_ids(payload)

        db.add(
            AIDocumentRecord(
                document_id=document_id,
                user_id=str(user.id),
                trip_id=tripId,
                filename=filename,
                document_type=document_type.value,
                workflow_mode=workflowMode.value,
                content_hash=content_hash,
                body_contents=global_cached_doc.body_contents,
                extracted_payload=payload.model_dump_json(by_alias=True),
                trip_import_payload=global_cached_doc.trip_import_payload,
            )
        )
        if workflowMode == AIDocumentWorkflowMode.ITINERARY_IMPORT:
            promote_to_draft(trip)
        await db.commit()
        return payload

    document_text = document_ingest.extract_text(filename, data)
    try:
        if workflowMode == AIDocumentWorkflowMode.ITINERARY_IMPORT:
            draft_trip = await trip_ai.structure_document(document_text)
            draft_stays = draft_trip.stays
            draft_travels = draft_trip.travels
            trip_import_payload = draft_trip.model_dump_json(by_alias=True)
        else:
            draft = await trip_ai.extract_document_records(document_text)
            draft_stays = draft.stays
            draft_travels = draft.travels
            trip_import_payload = None
    except HTTPException:
        raise
    except Exception:
        logger.exception("ai-document failed during extraction for %s", filename)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI document import failed. See server logs for details.",
        )

    document_id = cached_doc.document_id if cached_doc is not None else str(uuid.uuid4())
    payload = AIDocumentExtraction(
        documentId=document_id,
        tripId=tripId,
        filename=filename,
        documentType=document_type,
        workflowMode=workflowMode,
        cached=False,
        stays=draft_stays,
        travels=draft_travels,
    )

    if cached_doc is None:
        doc = AIDocumentRecord(
            document_id=document_id,
            user_id=str(user.id),
            trip_id=tripId,
            filename=filename,
            document_type=document_type.value,
            workflow_mode=workflowMode.value,
            content_hash=content_hash,
            body_contents=document_text,
            extracted_payload=payload.model_dump_json(by_alias=True),
            trip_import_payload=trip_import_payload,
        )
        db.add(doc)
    else:
        cached_doc.filename = filename
        cached_doc.document_type = document_type.value
        cached_doc.workflow_mode = workflowMode.value
        cached_doc.content_hash = content_hash
        cached_doc.body_contents = document_text
        cached_doc.extracted_payload = payload.model_dump_json(by_alias=True)
        cached_doc.trip_import_payload = trip_import_payload

    if workflowMode == AIDocumentWorkflowMode.ITINERARY_IMPORT:
        promote_to_draft(trip)

    await db.commit()
    elapsed = time.monotonic() - started
    logger.info(
        "ai-document done: file=%s trip=%s stays=%d travels=%d in %.1fs",
        filename,
        tripId,
        len(payload.stays),
        len(payload.travels),
        elapsed,
    )
    return payload


@router.post("/ai-documents/{document_id}/save", response_model=AIDocumentSaveResult)
async def save_ai_document_records(
    document_id: str,
    body: AIDocumentSaveRequest,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    rec = await db.get(AIDocumentRecord, document_id)
    if rec is None or rec.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    trip = await require_owned_trip(db, rec.trip_id, user)
    if not rec.extracted_payload:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No extracted payload to save")

    payload = AIDocumentExtraction.model_validate_json(rec.extracted_payload)
    selected_stay_ids = set(body.stay_detail_ids) if body.stay_detail_ids is not None else None
    selected_travel_ids = set(body.travel_detail_ids) if body.travel_detail_ids is not None else None

    if body.stays is not None:
        stays_to_save = list(body.stays)
    else:
        stays_to_save = [
            stay
            for stay in payload.stays
            if selected_stay_ids is None or stay.stay_detail_id in selected_stay_ids
        ]

    if body.travels is not None:
        travels_to_save = list(body.travels)
    else:
        travels_to_save = [
            travel
            for travel in payload.travels
            if selected_travel_ids is None or travel.travel_detail_id in selected_travel_ids
        ]

    stays_saved = 0
    travels_saved = 0

    async def _free_id(model, record_id: str | None) -> str | None:
        """None means "already saved into this trip" — skip it.

        Skipping an id that already exists is how re-saving the same document into
        the same trip stays idempotent. But it must be scoped to *this* trip: an id
        belonging to another trip means the extraction was reused from the content
        cache, and silently dropping the record is how "Imported 0 stay records"
        happened.
        """
        candidate = record_id or str(uuid.uuid4())
        clash = await db.get(model, candidate)
        if clash is None:
            return candidate
        if clash.trip_id == rec.trip_id:
            return None
        return str(uuid.uuid4())

    for stay in stays_to_save:
        stay_id = await _free_id(StayDetailRecord, stay.stay_detail_id)
        if stay_id is None:
            continue
        stay.stay_detail_id = stay_id
        await trip_write.create_stay(db, trip, stay)
        stays_saved += 1

    for travel in travels_to_save:
        travel_id = await _free_id(TravelDetailRecord, travel.travel_detail_id)
        if travel_id is None:
            continue
        travel.travel_detail_id = travel_id
        await trip_write.create_travel(db, trip, travel)
        travels_saved += 1

    await db.commit()

    return AIDocumentSaveResult(
        status="ok",
        tripId=rec.trip_id,
        documentId=rec.document_id,
        staysSaved=stays_saved,
        travelsSaved=travels_saved,
    )

