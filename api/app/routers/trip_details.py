"""CRUD endpoints for travel and stay details as first-class trip entities.

Stays and travels live directly under a trip (siblings of days). Timeline points
(check-in/check-out, departure/arrival) reference them by ID. These endpoints let
clients create, list, read, update, and delete them directly, including their
own locations.
"""

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import (
    active,
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripRecord,
)
from app.schemas import (
    StayDetail,
    StayDetailImport,
    StayDetailPatch,
    TravelDetail,
    TravelDetailImport,
    TravelDetailPatch,
)
from app.services.locations import location_rows
from app.services.detail_points import (
    CHECK_IN_DEFAULT_TIME,
    CHECK_OUT_DEFAULT_TIME,
    normalize_stay_wall_clock,
    soft_delete_generated_points_for_stay,
    soft_delete_generated_points_for_travel,
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services.timezones import derive_utc, infer_tzid_from_locations, parse_wall_clock, wall_clock_to_text

router = APIRouter(prefix="/trips/{trip_id}", tags=["trip details"])


async def _detail_locations(db: AsyncSession, *, stay_id=None, travel_id=None) -> list:
    if stay_id is not None:
        cond = LocationRecord.stay_detail_id == stay_id
    else:
        cond = LocationRecord.travel_detail_id == travel_id
    result = await db.execute(
        select(LocationRecord).where(cond).order_by(LocationRecord.sort_order)
    )
    return list(result.scalars().all())


async def _locations_by_owner(db: AsyncSession, *, stay_ids=None, travel_ids=None) -> dict[str, list]:
    """One query for a whole list's locations, grouped by owner id (review.md 1C-3)."""
    owner_ids = set(stay_ids or travel_ids or ())
    if not owner_ids:
        return {}
    column = LocationRecord.stay_detail_id if stay_ids else LocationRecord.travel_detail_id
    result = await db.execute(
        select(LocationRecord).where(column.in_(owner_ids)).order_by(LocationRecord.sort_order)
    )
    grouped: dict[str, list] = {}
    for loc in result.scalars().all():
        owner_id = loc.stay_detail_id if stay_ids else loc.travel_detail_id
        if owner_id in owner_ids:
            grouped.setdefault(owner_id, []).append(loc)
    return grouped


async def _replace_detail_locations(
    db: AsyncSession, locations_payload: list, *, stay_id=None, travel_id=None
) -> None:
    if stay_id is not None:
        await db.execute(delete(LocationRecord).where(LocationRecord.stay_detail_id == stay_id))
    else:
        await db.execute(delete(LocationRecord).where(LocationRecord.travel_detail_id == travel_id))
    for row in location_rows(locations_payload, stay_detail_id=stay_id, travel_detail_id=travel_id):
        db.add(row)


def _apply_stay_times(
    rec: StayDetailRecord,
    *,
    check_in_text: str | None,
    check_out_text: str | None,
    check_in_tzid: str | None,
    check_out_tzid: str | None,
) -> None:
    check_in_text = normalize_stay_wall_clock(check_in_text, default_time=CHECK_IN_DEFAULT_TIME)
    check_out_text = normalize_stay_wall_clock(check_out_text, default_time=CHECK_OUT_DEFAULT_TIME)
    rec.check_in_local = parse_wall_clock(check_in_text)
    rec.check_in_tzid = check_in_tzid
    rec.check_in_utc = derive_utc(rec.check_in_local, check_in_tzid)

    rec.check_out_local = parse_wall_clock(check_out_text)
    rec.check_out_tzid = check_out_tzid
    rec.check_out_utc = derive_utc(rec.check_out_local, check_out_tzid)


def _apply_travel_times(
    rec: TravelDetailRecord,
    *,
    departure_text: str | None,
    arrival_text: str | None,
    departure_tzid: str | None,
    arrival_tzid: str | None,
) -> None:
    rec.departure_local = parse_wall_clock(departure_text)
    rec.departure_tzid = departure_tzid
    rec.departure_utc = derive_utc(rec.departure_local, departure_tzid)

    rec.arrival_local = parse_wall_clock(arrival_text)
    rec.arrival_tzid = arrival_tzid
    rec.arrival_utc = derive_utc(rec.arrival_local, arrival_tzid)


# ── Travel details ────────────────────────────────────────────────────────

@router.get("/travel-details", response_model=list[TravelDetail])
async def list_travel_details(
    trip_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TravelDetailRecord).where(
            TravelDetailRecord.trip_id == trip_id,
            active(TravelDetailRecord),
        )
    )
    records = list(result.scalars().all())
    locs = await _locations_by_owner(db, travel_ids=[r.travel_detail_id for r in records])
    return [TravelDetail.from_record(r, locs.get(r.travel_detail_id, [])) for r in records]


@router.post("/travel-details", response_model=TravelDetail, status_code=status.HTTP_201_CREATED)
async def create_travel_detail(
    trip_id: str,
    body: TravelDetailImport,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    detail_id = body.travel_detail_id or str(uuid.uuid4())

    departure_tzid = body.departure_timezone_id or infer_tzid_from_locations(
        body.locations, role="origin", fallback=trip.default_timezone_id
    )
    arrival_tzid = body.arrival_timezone_id or infer_tzid_from_locations(
        body.locations, role="destination", fallback=trip.default_timezone_id
    )

    departure_local = parse_wall_clock(body.departure_date_time)
    arrival_local = parse_wall_clock(body.arrival_date_time)
    rec = TravelDetailRecord(
        travel_detail_id=detail_id,
        trip_id=trip_id,
        name=body.name,
        mode=body.mode,
        operator=body.operator,
        vehicle_number=body.vehicle_number,
        cabin_class=body.cabin_class,
        departure_local=departure_local,
        departure_tzid=departure_tzid,
        departure_utc=derive_utc(departure_local, departure_tzid),
        arrival_local=arrival_local,
        arrival_tzid=arrival_tzid,
        arrival_utc=derive_utc(arrival_local, arrival_tzid),
        confirmation_number=body.confirmation_number,
        description=body.description,
    )
    db.add(rec)
    await db.flush()
    await _replace_detail_locations(db, body.locations, travel_id=detail_id)
    await sync_travel_generated_points(db, travel=rec)
    await db.commit()
    await db.refresh(rec)
    locs = await _detail_locations(db, travel_id=detail_id)
    return TravelDetail.from_record(rec, locs)


@router.get("/travel-details/{travel_detail_id}", response_model=TravelDetail)
async def get_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(TravelDetailRecord, travel_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel detail not found")
    locs = await _detail_locations(db, travel_id=travel_detail_id)
    return TravelDetail.from_record(rec, locs)


@router.patch("/travel-details/{travel_detail_id}", response_model=TravelDetail)
async def patch_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    body: TravelDetailPatch,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(TravelDetailRecord, travel_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel detail not found")

    # Field names match the ORM columns 1:1 now that schemas are snake_case.
    for field in (
        "name",
        "mode",
        "operator",
        "vehicle_number",
        "cabin_class",
        "confirmation_number",
        "description",
    ):
        if field in body.model_fields_set:
            setattr(rec, field, getattr(body, field))

    current_departure_text = (
        body.departure_date_time
        if "departure_date_time" in body.model_fields_set
        else wall_clock_to_text(rec.departure_local)
    )
    current_arrival_text = (
        body.arrival_date_time
        if "arrival_date_time" in body.model_fields_set
        else wall_clock_to_text(rec.arrival_local)
    )

    locations_for_inference = body.locations if "locations" in body.model_fields_set else (
        await _detail_locations(db, travel_id=travel_detail_id)
    )

    departure_tzid = (
        body.departure_timezone_id
        if "departure_timezone_id" in body.model_fields_set
        else rec.departure_tzid
    ) or infer_tzid_from_locations(locations_for_inference, role="origin", fallback=trip.default_timezone_id)

    arrival_tzid = (
        body.arrival_timezone_id
        if "arrival_timezone_id" in body.model_fields_set
        else rec.arrival_tzid
    ) or infer_tzid_from_locations(locations_for_inference, role="destination", fallback=trip.default_timezone_id)

    _apply_travel_times(
        rec,
        departure_text=current_departure_text,
        arrival_text=current_arrival_text,
        departure_tzid=departure_tzid,
        arrival_tzid=arrival_tzid,
    )

    if "locations" in body.model_fields_set:
        await _replace_detail_locations(db, body.locations or [], travel_id=travel_detail_id)

    await sync_travel_generated_points(db, travel=rec)

    await db.commit()
    await db.refresh(rec)
    locs = await _detail_locations(db, travel_id=travel_detail_id)
    return TravelDetail.from_record(rec, locs)


@router.delete("/travel-details/{travel_detail_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(TravelDetailRecord, travel_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel detail not found")

    rec.is_deleted = True
    rec.deleted_at = datetime.now(timezone.utc)
    await soft_delete_generated_points_for_travel(db, travel_detail_id=travel_detail_id)
    await db.commit()


# ── Stay details ──────────────────────────────────────────────────────────

@router.get("/stay-details", response_model=list[StayDetail])
async def list_stay_details(
    trip_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip_id,
            active(StayDetailRecord),
        )
    )
    records = list(result.scalars().all())
    locs = await _locations_by_owner(db, stay_ids=[r.stay_detail_id for r in records])
    return [StayDetail.from_record(r, locs.get(r.stay_detail_id, [])) for r in records]


@router.post("/stay-details", response_model=StayDetail, status_code=status.HTTP_201_CREATED)
async def create_stay_detail(
    trip_id: str,
    body: StayDetailImport,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    detail_id = body.stay_detail_id or str(uuid.uuid4())

    check_in_tzid = body.check_in_timezone_id or infer_tzid_from_locations(
        body.locations, role="venue", fallback=trip.default_timezone_id
    )
    check_out_tzid = body.check_out_timezone_id or check_in_tzid

    check_in_local = parse_wall_clock(body.check_in)
    check_out_local = parse_wall_clock(body.check_out)
    rec = StayDetailRecord(
        stay_detail_id=detail_id,
        trip_id=trip_id,
        name=body.name,
        stay_type=body.stay_type,
        check_in_local=check_in_local,
        check_in_tzid=check_in_tzid,
        check_in_utc=derive_utc(check_in_local, check_in_tzid),
        check_out_local=check_out_local,
        check_out_tzid=check_out_tzid,
        check_out_utc=derive_utc(check_out_local, check_out_tzid),
        room_type=body.room_type,
        confirmation_number=body.confirmation_number,
        description=body.description,
    )
    db.add(rec)
    await db.flush()
    await _replace_detail_locations(db, body.locations, stay_id=detail_id)
    await sync_stay_generated_points(db, stay=rec)
    await db.commit()
    await db.refresh(rec)
    locs = await _detail_locations(db, stay_id=detail_id)
    return StayDetail.from_record(rec, locs)


@router.get("/stay-details/{stay_detail_id}", response_model=StayDetail)
async def get_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(StayDetailRecord, stay_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay detail not found")
    locs = await _detail_locations(db, stay_id=stay_detail_id)
    return StayDetail.from_record(rec, locs)


@router.patch("/stay-details/{stay_detail_id}", response_model=StayDetail)
async def patch_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    body: StayDetailPatch,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(StayDetailRecord, stay_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay detail not found")

    # Field names match the ORM columns 1:1 now that schemas are snake_case.
    for field in (
        "name",
        "stay_type",
        "room_type",
        "confirmation_number",
        "description",
    ):
        if field in body.model_fields_set:
            setattr(rec, field, getattr(body, field))

    current_check_in_text = (
        body.check_in
        if "check_in" in body.model_fields_set
        else wall_clock_to_text(rec.check_in_local)
    )
    current_check_out_text = (
        body.check_out
        if "check_out" in body.model_fields_set
        else wall_clock_to_text(rec.check_out_local)
    )

    locations_for_inference = body.locations if "locations" in body.model_fields_set else (
        await _detail_locations(db, stay_id=stay_detail_id)
    )

    check_in_tzid = (
        body.check_in_timezone_id
        if "check_in_timezone_id" in body.model_fields_set
        else rec.check_in_tzid
    ) or infer_tzid_from_locations(locations_for_inference, role="venue", fallback=trip.default_timezone_id)

    check_out_tzid = (
        body.check_out_timezone_id
        if "check_out_timezone_id" in body.model_fields_set
        else rec.check_out_tzid
    ) or check_in_tzid

    _apply_stay_times(
        rec,
        check_in_text=current_check_in_text,
        check_out_text=current_check_out_text,
        check_in_tzid=check_in_tzid,
        check_out_tzid=check_out_tzid,
    )

    if "locations" in body.model_fields_set:
        await _replace_detail_locations(db, body.locations or [], stay_id=stay_detail_id)

    await sync_stay_generated_points(db, stay=rec)

    await db.commit()
    await db.refresh(rec)
    locs = await _detail_locations(db, stay_id=stay_detail_id)
    return StayDetail.from_record(rec, locs)


@router.delete("/stay-details/{stay_detail_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(StayDetailRecord, stay_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay detail not found")

    rec.is_deleted = True
    rec.deleted_at = datetime.now(timezone.utc)
    await soft_delete_generated_points_for_stay(db, stay_detail_id=stay_detail_id)
    await db.commit()
