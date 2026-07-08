"""AI-assisted trip import.

Two separate passes, each its own endpoint:
  - POST /trip/ai-import  : structure a document into a draft TripImport.
  - POST /trip/ai-enhance : enrich an existing trip's descriptions.

Neither endpoint persists anything; the frontend saves via POST /trip/import.
"""

import logging
import time
from datetime import datetime, timezone
import hashlib
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.auth import require_auth
from app.database import get_db
from app.models import AIDocumentRecord, LocationRecord, StayDetailRecord, TravelDetailRecord, TripRecord, UserRecord
from app.schemas import AIDocumentExtraction, AIDocumentListItem, AIDocumentSaveRequest, AIDocumentSaveResult, TripImport
from app.services.detail_points import (
    CHECK_IN_DEFAULT_TIME,
    CHECK_OUT_DEFAULT_TIME,
    normalize_stay_wall_clock,
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services import document_ingest, trip_ai
from app.services.timezones import derive_utc, parse_wall_clock, tzid_from_coords, wall_clock_to_text

logger = logging.getLogger("app.ai_import")

router = APIRouter(tags=["import"])

_MAX_BYTES = 15 * 1024 * 1024  # 15 MB


def _location_tzid(loc):
    return getattr(loc, "timezoneId", None) or tzid_from_coords(getattr(loc, "lat", None), getattr(loc, "lng", None))


def _infer_tzid(locations, role=None, fallback=None):
    for loc in locations or []:
        if role and getattr(loc, "role", None) != role:
            continue
        tzid = _location_tzid(loc)
        if tzid:
            return tzid
    return fallback


def _document_payload(rec: AIDocumentRecord) -> AIDocumentExtraction:
    payload = AIDocumentExtraction.model_validate_json(rec.extracted_payload)
    payload.documentId = rec.document_id
    payload.tripId = rec.trip_id
    payload.filename = rec.filename
    return payload


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


@router.post("/trip/ai-document", response_model=AIDocumentExtraction)
async def ai_document_import(
    tripId: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    started = time.monotonic()
    filename = file.filename or "unknown"

    trip = await db.get(TripRecord, tripId)
    if trip is None or trip.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File is too large (max 15 MB).",
        )
    content_hash = hashlib.sha256(data).hexdigest()

    cached_result = await db.execute(
        select(AIDocumentRecord).where(
            AIDocumentRecord.user_id == str(user.id),
            AIDocumentRecord.trip_id == tripId,
            AIDocumentRecord.content_hash == content_hash,
        )
    )
    cached_doc = cached_result.scalar_one_or_none()
    if cached_doc is not None and cached_doc.extracted_payload:
        payload = AIDocumentExtraction.model_validate_json(cached_doc.extracted_payload)
        payload.cached = True
        payload.documentId = cached_doc.document_id
        payload.tripId = tripId
        payload.filename = filename
        cached_doc.updated_at = datetime.now(timezone.utc)
        await db.commit()
        return payload

    document_text = document_ingest.extract_text(filename, data)
    try:
        draft = await run_in_threadpool(trip_ai.extract_document_records, document_text)
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
        cached=False,
        stays=draft.stays,
        travels=draft.travels,
    )

    if cached_doc is None:
        doc = AIDocumentRecord(
            document_id=document_id,
            user_id=str(user.id),
            trip_id=tripId,
            filename=filename,
            content_hash=content_hash,
            body_contents=document_text,
            extracted_payload=payload.model_dump_json(),
        )
        db.add(doc)
    else:
        cached_doc.filename = filename
        cached_doc.content_hash = content_hash
        cached_doc.body_contents = document_text
        cached_doc.extracted_payload = payload.model_dump_json()
        cached_doc.updated_at = datetime.now(timezone.utc)

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


@router.get("/trips/{trip_id}/ai-documents", response_model=list[AIDocumentListItem])
async def list_ai_documents(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip = await db.get(TripRecord, trip_id)
    if trip is None or trip.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    result = await db.execute(
        select(AIDocumentRecord).where(
            AIDocumentRecord.user_id == str(user.id),
            AIDocumentRecord.trip_id == trip_id,
        )
    )
    out = []
    for rec in result.scalars().all():
        payload = _document_payload(rec) if rec.extracted_payload else None
        out.append(
            AIDocumentListItem(
                documentId=rec.document_id,
                tripId=rec.trip_id,
                filename=rec.filename,
                staysExtracted=len(payload.stays) if payload else 0,
                travelsExtracted=len(payload.travels) if payload else 0,
                createdAt=rec.created_at.isoformat() if rec.created_at else None,
                updatedAt=rec.updated_at.isoformat() if rec.updated_at else None,
            )
        )
    return out


@router.get("/trip/ai-document/{document_id}", response_model=AIDocumentExtraction)
async def get_ai_document_extraction(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    rec = await db.get(AIDocumentRecord, document_id)
    if rec is None or rec.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if not rec.extracted_payload:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document has no extracted payload")
    payload = _document_payload(rec)
    payload.cached = True
    return payload


@router.post("/trip/ai-document/{document_id}/regen", response_model=AIDocumentExtraction)
async def regen_ai_document_extraction(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    rec = await db.get(AIDocumentRecord, document_id)
    if rec is None or rec.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    try:
        draft = await run_in_threadpool(trip_ai.extract_document_records, rec.body_contents)
    except HTTPException:
        raise
    except Exception:
        logger.exception("ai-document regen failed for %s", rec.filename)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI document regen failed. See server logs for details.",
        )

    payload = AIDocumentExtraction(
        documentId=rec.document_id,
        tripId=rec.trip_id,
        filename=rec.filename,
        cached=False,
        stays=draft.stays,
        travels=draft.travels,
    )
    rec.extracted_payload = payload.model_dump_json()
    rec.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return payload


@router.post("/trip/ai-document/{document_id}/save", response_model=AIDocumentSaveResult)
async def save_ai_document_records(
    document_id: str,
    body: AIDocumentSaveRequest,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    rec = await db.get(AIDocumentRecord, document_id)
    if rec is None or rec.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    trip = await db.get(TripRecord, rec.trip_id)
    if trip is None or trip.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if not rec.extracted_payload:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No extracted payload to save")

    payload = AIDocumentExtraction.model_validate_json(rec.extracted_payload)
    selected_stay_ids = set(body.stayDetailIds) if body.stayDetailIds is not None else None
    selected_travel_ids = set(body.travelDetailIds) if body.travelDetailIds is not None else None

    if body.stays is not None:
        stays_to_save = list(body.stays)
    else:
        stays_to_save = [
            stay
            for stay in payload.stays
            if selected_stay_ids is None or stay.stayDetailId in selected_stay_ids
        ]

    if body.travels is not None:
        travels_to_save = list(body.travels)
    else:
        travels_to_save = [
            travel
            for travel in payload.travels
            if selected_travel_ids is None or travel.travelDetailId in selected_travel_ids
        ]

    stays_saved = 0
    travels_saved = 0

    for stay in stays_to_save:
        stay_id = stay.stayDetailId or str(uuid.uuid4())
        if await db.get(StayDetailRecord, stay_id):
            continue

        check_in_tzid = stay.checkInTimezoneId or _infer_tzid(
            stay.locations, role="venue", fallback=trip.default_timezone_id
        )
        check_out_tzid = stay.checkOutTimezoneId or check_in_tzid
        check_in_text = normalize_stay_wall_clock(stay.checkIn, default_time=CHECK_IN_DEFAULT_TIME)
        check_out_text = normalize_stay_wall_clock(stay.checkOut, default_time=CHECK_OUT_DEFAULT_TIME)
        check_in_local = parse_wall_clock(check_in_text)
        check_out_local = parse_wall_clock(check_out_text)

        db.add(
            StayDetailRecord(
                stay_detail_id=stay_id,
                trip_id=rec.trip_id,
                name=stay.name,
                stay_type=stay.stayType,
                check_in_local=check_in_local,
                check_in_tzid=check_in_tzid,
                check_in_utc=derive_utc(check_in_local, check_in_tzid),
                check_out_local=check_out_local,
                check_out_tzid=check_out_tzid,
                check_out_utc=derive_utc(check_out_local, check_out_tzid),
                check_in=wall_clock_to_text(check_in_local),
                check_out=wall_clock_to_text(check_out_local),
                room_type=stay.roomType,
                confirmation_number=stay.confirmationNumber,
                description=stay.description,
            )
        )
        await db.flush()
        rec_stay = await db.get(StayDetailRecord, stay_id)
        for i, loc in enumerate(stay.locations):
            db.add(
                LocationRecord(
                    location_id=loc.locationId,
                    point_id=None,
                    stay_detail_id=stay_id,
                    travel_detail_id=None,
                    role=loc.role,
                    sort_order=i,
                    name=loc.name,
                    lat=loc.lat,
                    lng=loc.lng,
                    full_address=loc.fullAddress,
                    description=loc.description,
                    link=loc.link,
                    google_place_id=loc.googlePlaceId,
                    google_maps_uri=loc.googleMapsUri,
                    timezone_id=_location_tzid(loc),
                )
            )
        if rec_stay is not None:
            await sync_stay_generated_points(db, stay=rec_stay)
        stays_saved += 1

    for travel in travels_to_save:
        travel_id = travel.travelDetailId or str(uuid.uuid4())
        if await db.get(TravelDetailRecord, travel_id):
            continue

        departure_tzid = travel.departureTimezoneId or _infer_tzid(
            travel.locations, role="origin", fallback=trip.default_timezone_id
        )
        arrival_tzid = travel.arrivalTimezoneId or _infer_tzid(
            travel.locations, role="destination", fallback=trip.default_timezone_id
        )
        departure_local = parse_wall_clock(travel.departureDateTime)
        arrival_local = parse_wall_clock(travel.arrivalDateTime)

        db.add(
            TravelDetailRecord(
                travel_detail_id=travel_id,
                trip_id=rec.trip_id,
                name=travel.name,
                mode=travel.mode,
                operator=travel.operator,
                vehicle_number=travel.vehicleNumber,
                cabin_class=travel.cabinClass,
                departure_local=departure_local,
                departure_tzid=departure_tzid,
                departure_utc=derive_utc(departure_local, departure_tzid),
                arrival_local=arrival_local,
                arrival_tzid=arrival_tzid,
                arrival_utc=derive_utc(arrival_local, arrival_tzid),
                departure_date_time=wall_clock_to_text(departure_local),
                arrival_date_time=wall_clock_to_text(arrival_local),
                confirmation_number=travel.confirmationNumber,
                description=travel.description,
            )
        )
        await db.flush()
        rec_travel = await db.get(TravelDetailRecord, travel_id)
        for i, loc in enumerate(travel.locations):
            db.add(
                LocationRecord(
                    location_id=loc.locationId,
                    point_id=None,
                    stay_detail_id=None,
                    travel_detail_id=travel_id,
                    role=loc.role,
                    sort_order=i,
                    name=loc.name,
                    lat=loc.lat,
                    lng=loc.lng,
                    full_address=loc.fullAddress,
                    description=loc.description,
                    link=loc.link,
                    google_place_id=loc.googlePlaceId,
                    google_maps_uri=loc.googleMapsUri,
                    timezone_id=_location_tzid(loc),
                )
            )
        if rec_travel is not None:
            await sync_travel_generated_points(db, travel=rec_travel)
        travels_saved += 1

    rec.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return AIDocumentSaveResult(
        status="ok",
        tripId=rec.trip_id,
        documentId=rec.document_id,
        staysSaved=stays_saved,
        travelsSaved=travels_saved,
    )

