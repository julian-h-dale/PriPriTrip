"""AI-assisted trip import: upload a document, get back a draft TripImport.

The endpoint does NOT persist anything. It returns a draft trip (with generated
IDs) that the frontend can review, then save via the existing POST /trip/import.
"""

from fastapi import APIRouter, Depends, File, UploadFile

from app.auth import require_auth
from app.models import UserRecord
from app.schemas import TripImport
from app.services import document_ingest, trip_ai

router = APIRouter(tags=["import"])

_MAX_BYTES = 15 * 1024 * 1024  # 15 MB


@router.post("/trip/ai-import", response_model=TripImport)
async def ai_import(
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_auth),
):
    from fastapi import HTTPException, status

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File is too large (max 15 MB).",
        )

    document_text = document_ingest.extract_text(file.filename or "", data)
    draft = trip_ai.build_trip_from_document(document_text)
    return draft
