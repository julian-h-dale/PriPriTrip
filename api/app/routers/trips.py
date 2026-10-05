"""Trips router. Thin handlers: reads via get_viewable_trip (any member),
edits via get_editable_trip (owner or editor), deleting the trip via
get_owned_trip (owner only), logic in services/trips.py, document validation
in app/trip_document.py. Changing or deleting an entry needs the version it
was made from (If-Match; services/versions.py)."""

from __future__ import annotations

import datetime as dt
import json
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.database import get_db
from app.dependencies import (
    ViewableTrip,
    get_editable_item,
    get_editable_stay,
    get_editable_travel,
    get_editable_trip,
    get_owned_trip,
    get_viewable_trip,
    if_match_version,
)
from app.models import Item, Stay, Travel, Trip, UserRecord
from app.schemas import CamelModel, TripRead, TripSummary
from app.services import trips as trips_service
from app.trip_document import (
    DayWrite,
    TripDocument,
    TripDocumentError,
    TripFrame,
    parse_part,
    trip_json_schema,
    validate_day_date,
    validate_item_write,
    validate_stay_write,
    validate_travel_write,
    validate_trip_document,
)
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


def _invalid(exc: TripDocumentError, what: str) -> JSONResponse:
    """422 with every problem and its path — the same shape for imports and edits."""
    count = len(exc.errors)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": f"{what} has {count} problem{'s' if count != 1 else ''}.",
            "errors": [{"path": e.path, "message": e.message} for e in exc.errors],
        },
    )


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
        return _invalid(exc, "The trip document")
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
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
) -> TripRead:
    """The whole trip, for its owner or anyone who joined it (with their role)."""
    return await trips_service.get_trip(db, viewable.trip.id, viewable.role)


@router.get(
    "/{trip_id}/export",
    response_model=TripDocument,
    response_model_by_alias=True,
    response_model_exclude_none=True,
)
async def export_trip(
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """The trip as a downloadable trip document, ready to import elsewhere."""
    doc = await trips_service.export_trip(db, viewable.trip.id)
    slug = re.sub(r"[^a-z0-9]+", "-", doc.name.lower()).strip("-") or "trip"
    return JSONResponse(
        doc.model_dump(mode="json", by_alias=True, exclude_none=True),
        headers={"Content-Disposition": f'attachment; filename="{slug}.json"'},
    )


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await trips_service.delete_trip(db, trip)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- Editing activities and days ----
#
# Bodies are validated by the trip-document models and rules (not FastAPI's
# own validation), so an edit is rejected exactly as an import would be, with
# the same {detail, errors: [{path, message}]} shape. Every write returns the
# whole updated trip.

JsonBody = Annotated[dict[str, Any], Body()]


@router.post(
    "/{trip_id}/items",
    response_model=TripRead,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_item(
    body: JsonBody,
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> TripRead | JSONResponse:
    """Add an activity (an `ItemDoc` plus its `date`) at the end of that date."""
    try:
        write = validate_item_write(body, trip.start_date, trip.end_date)
    except TripDocumentError as exc:
        return _invalid(exc, "The activity")
    return await trips_service.create_item(db, trip, write, user.id)


@router.put("/{trip_id}/items/{item_id}", response_model=TripRead, response_model_exclude_none=True)
async def replace_item(
    body: JsonBody,
    trip: Trip = Depends(get_editable_trip),
    item: Item = Depends(get_editable_item),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    expected: int = Depends(if_match_version),
) -> TripRead | JSONResponse:
    """Replace a whole activity. A different `date` moves it to that day."""
    try:
        write = validate_item_write(body, trip.start_date, trip.end_date)
    except TripDocumentError as exc:
        return _invalid(exc, "The activity")
    return await trips_service.replace_item(
        db, trip, item, write, expected=expected, user_id=user.id
    )


@router.delete(
    "/{trip_id}/items/{item_id}", response_model=TripRead, response_model_exclude_none=True
)
async def delete_item(
    trip: Trip = Depends(get_editable_trip),
    item: Item = Depends(get_editable_item),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    expected: int = Depends(if_match_version),
) -> TripRead:
    return await trips_service.delete_item(db, trip, item, expected=expected, user_id=user.id)


class MoveRequest(CamelModel):
    direction: Literal["up", "down"]


@router.post(
    "/{trip_id}/items/{item_id}/move", response_model=TripRead, response_model_exclude_none=True
)
async def move_item(
    body: MoveRequest,
    trip: Trip = Depends(get_editable_trip),
    item: Item = Depends(get_editable_item),
    db: AsyncSession = Depends(get_db),
) -> TripRead:
    """Swap an activity with its neighbour in the day."""
    return await trips_service.move_item(db, trip, item, body.direction)


@router.put("/{trip_id}/days/{day_date}", response_model=TripRead, response_model_exclude_none=True)
async def update_day(
    day_date: dt.date,
    body: JsonBody,
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    expected: int = Depends(if_match_version),
) -> TripRead | JSONResponse:
    """Set a date's title and summary (creates the day if the date has none:
    its version is then 0)."""
    try:
        validate_day_date(day_date, trip.start_date, trip.end_date)
        write = parse_part(DayWrite, body)
    except TripDocumentError as exc:
        return _invalid(exc, "The day")
    return await trips_service.update_day(
        db, trip, day_date, write, expected=expected, user_id=user.id
    )


# ---- Editing stays and travel ----


def _frame(trip: Trip) -> TripFrame:
    return TripFrame(trip.start_date, trip.end_date, trip.timezone)


@router.post(
    "/{trip_id}/stays",
    response_model=TripRead,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_stay(
    body: JsonBody,
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> TripRead | JSONResponse:
    try:
        doc = validate_stay_write(body, _frame(trip))
    except TripDocumentError as exc:
        return _invalid(exc, "The stay")
    return await trips_service.create_stay(db, trip, doc, user.id)


@router.put("/{trip_id}/stays/{stay_id}", response_model=TripRead, response_model_exclude_none=True)
async def replace_stay(
    body: JsonBody,
    trip: Trip = Depends(get_editable_trip),
    stay: Stay = Depends(get_editable_stay),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    expected: int = Depends(if_match_version),
) -> TripRead | JSONResponse:
    try:
        doc = validate_stay_write(body, _frame(trip))
    except TripDocumentError as exc:
        return _invalid(exc, "The stay")
    return await trips_service.replace_stay(db, trip, stay, doc, expected=expected, user_id=user.id)


@router.delete(
    "/{trip_id}/stays/{stay_id}", response_model=TripRead, response_model_exclude_none=True
)
async def delete_stay(
    trip: Trip = Depends(get_editable_trip),
    stay: Stay = Depends(get_editable_stay),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    expected: int = Depends(if_match_version),
) -> TripRead:
    return await trips_service.delete_stay(db, trip, stay, expected=expected, user_id=user.id)


@router.post(
    "/{trip_id}/travels",
    response_model=TripRead,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_travel(
    body: JsonBody,
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> TripRead | JSONResponse:
    try:
        doc = validate_travel_write(body, _frame(trip))
    except TripDocumentError as exc:
        return _invalid(exc, "The travel leg")
    return await trips_service.create_travel(db, trip, doc, user.id)


@router.put(
    "/{trip_id}/travels/{travel_id}", response_model=TripRead, response_model_exclude_none=True
)
async def replace_travel(
    body: JsonBody,
    trip: Trip = Depends(get_editable_trip),
    travel: Travel = Depends(get_editable_travel),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    expected: int = Depends(if_match_version),
) -> TripRead | JSONResponse:
    try:
        doc = validate_travel_write(body, _frame(trip))
    except TripDocumentError as exc:
        return _invalid(exc, "The travel leg")
    return await trips_service.replace_travel(
        db, trip, travel, doc, expected=expected, user_id=user.id
    )


@router.delete(
    "/{trip_id}/travels/{travel_id}", response_model=TripRead, response_model_exclude_none=True
)
async def delete_travel(
    trip: Trip = Depends(get_editable_trip),
    travel: Travel = Depends(get_editable_travel),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    expected: int = Depends(if_match_version),
) -> TripRead:
    return await trips_service.delete_travel(db, trip, travel, expected=expected, user_id=user.id)


@schema_router.get("/trip")
async def get_trip_schema() -> dict[str, Any]:
    """The trip document JSON Schema. Public: it describes a format, not data."""
    return trip_json_schema()
