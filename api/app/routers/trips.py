"""Trips router. Thin handlers: ownership via get_owned_trip, logic in
services/trips.py, document validation in app/trip_document.py."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import Trip, UserRecord
from app.schemas import TripRead, TripSummary
from app.services import trips as trips_service
from app.trip_document import TripDocumentError, trip_json_schema, validate_trip_document
from app.users import current_active_user

router = APIRouter(prefix="/trips", tags=["trips"])
schema_router = APIRouter(prefix="/schema", tags=["schema"])

MAX_UPLOAD_BYTES = 1_000_000
# Multipart framing around the file; generous, it only gates the early check.
_MULTIPART_OVERHEAD = 16_384

_IMPORT_BODY_DOCS: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "description": "A trip document: as a `file` form field, or as the raw JSON body.",
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "properties": {"file": {"type": "string", "format": "binary"}},
                    "required": ["file"],
                }
            },
            "application/json": {"schema": {"$ref": "/schema/trip"}},
        },
    }
}


def _too_large() -> HTTPException:
    return HTTPException(
        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        f"Trip documents are limited to {MAX_UPLOAD_BYTES // 1_000_000} MB",
    )


async def _read_document_bytes(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES + _MULTIPART_OVERHEAD:
        raise _too_large()

    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form(max_files=1, max_fields=1)
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Upload the trip document in a 'file' field"
            )
        raw = await upload.read(MAX_UPLOAD_BYTES + 1)
    else:
        raw = await request.body()

    if len(raw) > MAX_UPLOAD_BYTES:
        raise _too_large()
    return raw


@router.post(
    "/import",
    response_model=TripSummary,
    status_code=status.HTTP_201_CREATED,
    openapi_extra=_IMPORT_BODY_DOCS,
    responses={422: {"description": "The document is invalid; every problem has a path."}},
)
async def import_trip(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> TripSummary | JSONResponse:
    """Create a brand-new trip from a trip document. Never updates or merges."""
    raw = await _read_document_bytes(request)
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Not valid JSON: {exc}") from None

    try:
        doc = validate_trip_document(data)
    except TripDocumentError as exc:
        count = len(exc.errors)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": f"The trip document has {count} problem{'s' if count != 1 else ''}.",
                "errors": [{"path": e.path, "message": e.message} for e in exc.errors],
            },
        )
    return await trips_service.import_trip(db, user.id, doc)


@router.get("", response_model=list[TripSummary])
async def list_trips(
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> list[TripSummary]:
    return await trips_service.list_trips(db, user.id)


# exclude_none: the read shape is the document shape, which omits absent fields.
@router.get("/{trip_id}", response_model=TripRead, response_model_exclude_none=True)
async def get_trip(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> TripRead:
    return await trips_service.get_trip(db, trip.id)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await trips_service.delete_trip(db, trip)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@schema_router.get("/trip")
async def get_trip_schema() -> dict[str, Any]:
    """The trip document JSON Schema. Public: it describes a format, not data."""
    return trip_json_schema()
