"""AI-assisted trip import.

Trip-scoped endpoints:
  - POST /trips/ai-import               : structure a document into a new draft TripImport.
  - POST /trips/{trip_id}/ai-import     : same, for an existing trip (records the document).
  - POST /trips/ai-enhance              : enrich a draft trip's descriptions.
  - POST /trips/{trip_id}/ai-documents  : extract stay/travel records from a document.
  - GET  /trips/{trip_id}/ai-documents  : list a trip's AI documents.

Document-scoped endpoints:
  - GET  /ai-documents/{document_id}        : re-read a stored extraction.
  - POST /ai-documents/{document_id}/regen  : re-run extraction on the stored text.
  - POST /ai-documents/{document_id}/save   : persist selected extracted records.

Draft structuring persists nothing; the frontend saves via POST /trips/{trip_id}/import.
"""

import logging
import time
from datetime import datetime, timezone
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
from app.schemas import AIDocumentExtraction, AIDocumentListItem, AIDocumentSaveRequest, AIDocumentSaveResult, TripImport
from app.services.detail_points import (
    CHECK_IN_DEFAULT_TIME,
    CHECK_OUT_DEFAULT_TIME,
    normalize_stay_wall_clock,
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services import document_ingest, trip_ai
from app.services.locations import location_rows
from app.services.timezones import derive_utc, infer_tzid_from_locations, parse_wall_clock, wall_clock_to_text

logger = logging.getLogger("app.ai_import")

router = APIRouter(tags=["import"])

_MAX_BYTES = 15 * 1024 * 1024  # 15 MB


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
        now = datetime.now(timezone.utc)
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
        trip.status = "draft"
        trip.updated_at = now
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
            trip.status = "draft"
            trip.updated_at = datetime.now(timezone.utc)
        cached_doc.updated_at = datetime.now(timezone.utc)
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
            now = datetime.now(timezone.utc)
            trip.status = "draft"
            trip.updated_at = now
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
        cached_doc.updated_at = datetime.now(timezone.utc)

    if workflowMode == AIDocumentWorkflowMode.ITINERARY_IMPORT:
        now = datetime.now(timezone.utc)
        trip.status = "draft"
        trip.updated_at = now

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
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    result = await db.execute(
        select(AIDocumentRecord).where(
            AIDocumentRecord.user_id == str(user.id),
            AIDocumentRecord.trip_id == trip.trip_id,
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
                documentType=AIDocumentType(getattr(rec, "document_type", AIDocumentType.DETAIL.value)),
                workflowMode=AIDocumentWorkflowMode(getattr(rec, "workflow_mode", AIDocumentWorkflowMode.DETAIL_IMPORT.value)),
                staysExtracted=len(payload.stays) if payload else 0,
                travelsExtracted=len(payload.travels) if payload else 0,
                createdAt=rec.created_at.isoformat() if rec.created_at else None,
                updatedAt=rec.updated_at.isoformat() if rec.updated_at else None,
            )
        )
    return out


@router.get("/ai-documents/{document_id}", response_model=AIDocumentExtraction)
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


@router.post("/ai-documents/{document_id}/regen", response_model=AIDocumentExtraction)
async def regen_ai_document_extraction(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    rec = await db.get(AIDocumentRecord, document_id)
    if rec is None or rec.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    try:
        draft = await trip_ai.extract_document_records(rec.body_contents)
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
        documentType=AIDocumentType(getattr(rec, "document_type", AIDocumentType.DETAIL.value)),
        workflowMode=AIDocumentWorkflowMode(getattr(rec, "workflow_mode", AIDocumentWorkflowMode.DETAIL_IMPORT.value)),
        cached=False,
        stays=draft.stays,
        travels=draft.travels,
    )
    rec.extracted_payload = payload.model_dump_json(by_alias=True)
    rec.updated_at = datetime.now(timezone.utc)
    await db.commit()
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

    for stay in stays_to_save:
        stay_id = stay.stay_detail_id or str(uuid.uuid4())
        if await db.get(StayDetailRecord, stay_id):
            continue

        check_in_tzid = stay.check_in_timezone_id or infer_tzid_from_locations(
            stay.locations, role="venue", fallback=trip.default_timezone_id
        )
        check_out_tzid = stay.check_out_timezone_id or check_in_tzid
        check_in_text = normalize_stay_wall_clock(stay.check_in, default_time=CHECK_IN_DEFAULT_TIME)
        check_out_text = normalize_stay_wall_clock(stay.check_out, default_time=CHECK_OUT_DEFAULT_TIME)
        check_in_local = parse_wall_clock(check_in_text)
        check_out_local = parse_wall_clock(check_out_text)

        db.add(
            StayDetailRecord(
                stay_detail_id=stay_id,
                trip_id=rec.trip_id,
                name=stay.name,
                stay_type=stay.stay_type,
                check_in_local=check_in_local,
                check_in_tzid=check_in_tzid,
                check_in_utc=derive_utc(check_in_local, check_in_tzid),
                check_out_local=check_out_local,
                check_out_tzid=check_out_tzid,
                check_out_utc=derive_utc(check_out_local, check_out_tzid),
                check_in=wall_clock_to_text(check_in_local),
                check_out=wall_clock_to_text(check_out_local),
                room_type=stay.room_type,
                confirmation_number=stay.confirmation_number,
                description=stay.description,
            )
        )
        await db.flush()
        rec_stay = await db.get(StayDetailRecord, stay_id)
        for row in location_rows(stay.locations, stay_detail_id=stay_id):
            db.add(row)
        if rec_stay is not None:
            await sync_stay_generated_points(db, stay=rec_stay)
        stays_saved += 1

    for travel in travels_to_save:
        travel_id = travel.travel_detail_id or str(uuid.uuid4())
        if await db.get(TravelDetailRecord, travel_id):
            continue

        departure_tzid = travel.departure_timezone_id or infer_tzid_from_locations(
            travel.locations, role="origin", fallback=trip.default_timezone_id
        )
        arrival_tzid = travel.arrival_timezone_id or infer_tzid_from_locations(
            travel.locations, role="destination", fallback=trip.default_timezone_id
        )
        departure_local = parse_wall_clock(travel.departure_date_time)
        arrival_local = parse_wall_clock(travel.arrival_date_time)

        db.add(
            TravelDetailRecord(
                travel_detail_id=travel_id,
                trip_id=rec.trip_id,
                name=travel.name,
                mode=travel.mode,
                operator=travel.operator,
                vehicle_number=travel.vehicle_number,
                cabin_class=travel.cabin_class,
                departure_local=departure_local,
                departure_tzid=departure_tzid,
                departure_utc=derive_utc(departure_local, departure_tzid),
                arrival_local=arrival_local,
                arrival_tzid=arrival_tzid,
                arrival_utc=derive_utc(arrival_local, arrival_tzid),
                departure_date_time=wall_clock_to_text(departure_local),
                arrival_date_time=wall_clock_to_text(arrival_local),
                confirmation_number=travel.confirmation_number,
                description=travel.description,
            )
        )
        await db.flush()
        rec_travel = await db.get(TravelDetailRecord, travel_id)
        for row in location_rows(travel.locations, travel_detail_id=travel_id):
            db.add(row)
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

