"""CRUD endpoints for travel and stay details as first-class trip entities.

Stays and travels live directly under a trip (siblings of days). Timeline points
(check-in/check-out, departure/arrival) reference them by ID. These endpoints let
clients create, list, read, update, and delete them directly, including their
own locations.
"""

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripPointRecord,
    TripRecord,
    UserRecord,
)
from app.schemas import (
    StayDetail,
    StayDetailImport,
    StayDetailPatch,
    TravelDetail,
    TravelDetailImport,
    TravelDetailPatch,
)
from app.serializers import stay_to_response, travel_to_response
from app.services.detail_points import (
    CHECK_IN_DEFAULT_TIME,
    CHECK_OUT_DEFAULT_TIME,
    normalize_stay_wall_clock,
    soft_delete_generated_points_for_stay,
    soft_delete_generated_points_for_travel,
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services.timezones import derive_utc, parse_wall_clock, tzid_from_coords, wall_clock_to_text

router = APIRouter(prefix="/trips/{trip_id}", tags=["trip details"])


def _require_trip(trip: TripRecord | None, user: UserRecord) -> None:
    if (
        trip is None
        or trip.user_id != str(user.id)
        or bool(getattr(trip, "is_deleted", False))
        or getattr(trip, "deleted_at", None) is not None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")


async def _detail_locations(db: AsyncSession, *, stay_id=None, travel_id=None) -> list:
    if stay_id is not None:
        cond = LocationRecord.stay_detail_id == stay_id
    else:
        cond = LocationRecord.travel_detail_id == travel_id
    result = await db.execute(
        select(LocationRecord).where(cond).order_by(LocationRecord.sort_order)
    )
    return list(result.scalars().all())


async def _replace_detail_locations(
    db: AsyncSession, locations_payload: list, *, stay_id=None, travel_id=None
) -> None:
    if stay_id is not None:
        await db.execute(delete(LocationRecord).where(LocationRecord.stay_detail_id == stay_id))
    else:
        await db.execute(delete(LocationRecord).where(LocationRecord.travel_detail_id == travel_id))
    for i, loc in enumerate(locations_payload):
        db.add(
            LocationRecord(
                location_id=loc.locationId,
                point_id=None,
                stay_detail_id=stay_id,
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
                timezone_id=loc.timezoneId or tzid_from_coords(loc.lat, loc.lng),
            )
        )


def _location_tzid(loc) -> str | None:
    return getattr(loc, "timezoneId", None) or tzid_from_coords(getattr(loc, "lat", None), getattr(loc, "lng", None))


def _infer_tzid_from_locations(locations: list, *, role: str | None = None, fallback: str | None = None) -> str | None:
    for loc in locations or []:
        if role and getattr(loc, "role", None) != role:
            continue
        tzid = _location_tzid(loc)
        if tzid:
            return tzid
    return fallback


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
    rec.check_in = wall_clock_to_text(rec.check_in_local)

    rec.check_out_local = parse_wall_clock(check_out_text)
    rec.check_out_tzid = check_out_tzid
    rec.check_out_utc = derive_utc(rec.check_out_local, check_out_tzid)
    rec.check_out = wall_clock_to_text(rec.check_out_local)


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
    rec.departure_date_time = wall_clock_to_text(rec.departure_local)

    rec.arrival_local = parse_wall_clock(arrival_text)
    rec.arrival_tzid = arrival_tzid
    rec.arrival_utc = derive_utc(rec.arrival_local, arrival_tzid)
    rec.arrival_date_time = wall_clock_to_text(rec.arrival_local)


# ── Travel details ────────────────────────────────────────────────────────

@router.get("/travel-details", response_model=list[TravelDetail])
async def list_travel_details(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), user)
    result = await db.execute(
        select(TravelDetailRecord).where(
            TravelDetailRecord.trip_id == trip_id,
            TravelDetailRecord.is_deleted.is_(False),
            TravelDetailRecord.deleted_at.is_(None),
        )
    )
    out = []
    for rec in result.scalars().all():
        locs = await _detail_locations(db, travel_id=rec.travel_detail_id)
        out.append(travel_to_response(rec, locs))
    return out


@router.post("/travel-details", response_model=TravelDetail, status_code=status.HTTP_201_CREATED)
async def create_travel_detail(
    trip_id: str,
    body: TravelDetailImport,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip = await db.get(TripRecord, trip_id)
    _require_trip(trip, user)
    detail_id = body.travelDetailId or str(uuid.uuid4())

    departure_tzid = body.departureTimezoneId or _infer_tzid_from_locations(
        body.locations, role="origin", fallback=trip.default_timezone_id
    )
    arrival_tzid = body.arrivalTimezoneId or _infer_tzid_from_locations(
        body.locations, role="destination", fallback=trip.default_timezone_id
    )

    departure_local = parse_wall_clock(body.departureDateTime)
    arrival_local = parse_wall_clock(body.arrivalDateTime)
    rec = TravelDetailRecord(
        travel_detail_id=detail_id,
        trip_id=trip_id,
        name=body.name,
        mode=body.mode,
        operator=body.operator,
        vehicle_number=body.vehicleNumber,
        cabin_class=body.cabinClass,
        departure_local=departure_local,
        departure_tzid=departure_tzid,
        departure_utc=derive_utc(departure_local, departure_tzid),
        arrival_local=arrival_local,
        arrival_tzid=arrival_tzid,
        arrival_utc=derive_utc(arrival_local, arrival_tzid),
        departure_date_time=wall_clock_to_text(departure_local),
        arrival_date_time=wall_clock_to_text(arrival_local),
        confirmation_number=body.confirmationNumber,
        description=body.description,
    )
    db.add(rec)
    await db.flush()
    await _replace_detail_locations(db, body.locations, travel_id=detail_id)
    await sync_travel_generated_points(db, travel=rec)
    await db.commit()
    await db.refresh(rec)
    locs = await _detail_locations(db, travel_id=detail_id)
    return travel_to_response(rec, locs)


@router.get("/travel-details/{travel_detail_id}", response_model=TravelDetail)
async def get_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), user)
    rec = await db.get(TravelDetailRecord, travel_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel detail not found")
    locs = await _detail_locations(db, travel_id=travel_detail_id)
    return travel_to_response(rec, locs)


@router.patch("/travel-details/{travel_detail_id}", response_model=TravelDetail)
async def patch_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    body: TravelDetailPatch,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip = await db.get(TripRecord, trip_id)
    _require_trip(trip, user)
    rec = await db.get(TravelDetailRecord, travel_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel detail not found")

    field_map = {
        "name": "name",
        "mode": "mode",
        "operator": "operator",
        "vehicleNumber": "vehicle_number",
        "cabinClass": "cabin_class",
        "departureDateTime": "departure_date_time",
        "arrivalDateTime": "arrival_date_time",
        "confirmationNumber": "confirmation_number",
        "description": "description",
    }
    for pydantic_field, orm_field in field_map.items():
        if pydantic_field in body.model_fields_set:
            setattr(rec, orm_field, getattr(body, pydantic_field))

    current_departure_text = (
        body.departureDateTime
        if "departureDateTime" in body.model_fields_set
        else (wall_clock_to_text(rec.departure_local) or rec.departure_date_time)
    )
    current_arrival_text = (
        body.arrivalDateTime
        if "arrivalDateTime" in body.model_fields_set
        else (wall_clock_to_text(rec.arrival_local) or rec.arrival_date_time)
    )

    locations_for_inference = body.locations if "locations" in body.model_fields_set else (
        await _detail_locations(db, travel_id=travel_detail_id)
    )

    departure_tzid = (
        body.departureTimezoneId
        if "departureTimezoneId" in body.model_fields_set
        else rec.departure_tzid
    ) or _infer_tzid_from_locations(locations_for_inference, role="origin", fallback=trip.default_timezone_id)

    arrival_tzid = (
        body.arrivalTimezoneId
        if "arrivalTimezoneId" in body.model_fields_set
        else rec.arrival_tzid
    ) or _infer_tzid_from_locations(locations_for_inference, role="destination", fallback=trip.default_timezone_id)

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
    return travel_to_response(rec, locs)


@router.delete("/travel-details/{travel_detail_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), user)
    rec = await db.get(TravelDetailRecord, travel_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel detail not found")

    rec.is_deleted = True
    rec.deleted_at = datetime.now(timezone.utc)
    rec.updated_at = datetime.now(timezone.utc)
    await soft_delete_generated_points_for_travel(db, travel_detail_id=travel_detail_id)
    await db.commit()


# ── Stay details ──────────────────────────────────────────────────────────

@router.get("/stay-details", response_model=list[StayDetail])
async def list_stay_details(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), user)
    result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip_id,
            StayDetailRecord.is_deleted.is_(False),
            StayDetailRecord.deleted_at.is_(None),
        )
    )
    out = []
    for rec in result.scalars().all():
        locs = await _detail_locations(db, stay_id=rec.stay_detail_id)
        out.append(stay_to_response(rec, locs))
    return out


@router.post("/stay-details", response_model=StayDetail, status_code=status.HTTP_201_CREATED)
async def create_stay_detail(
    trip_id: str,
    body: StayDetailImport,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip = await db.get(TripRecord, trip_id)
    _require_trip(trip, user)
    detail_id = body.stayDetailId or str(uuid.uuid4())

    check_in_tzid = body.checkInTimezoneId or _infer_tzid_from_locations(
        body.locations, role="venue", fallback=trip.default_timezone_id
    )
    check_out_tzid = body.checkOutTimezoneId or check_in_tzid

    check_in_local = parse_wall_clock(body.checkIn)
    check_out_local = parse_wall_clock(body.checkOut)
    rec = StayDetailRecord(
        stay_detail_id=detail_id,
        trip_id=trip_id,
        name=body.name,
        stay_type=body.stayType,
        check_in_local=check_in_local,
        check_in_tzid=check_in_tzid,
        check_in_utc=derive_utc(check_in_local, check_in_tzid),
        check_out_local=check_out_local,
        check_out_tzid=check_out_tzid,
        check_out_utc=derive_utc(check_out_local, check_out_tzid),
        check_in=wall_clock_to_text(check_in_local),
        check_out=wall_clock_to_text(check_out_local),
        room_type=body.roomType,
        confirmation_number=body.confirmationNumber,
        description=body.description,
    )
    db.add(rec)
    await db.flush()
    await _replace_detail_locations(db, body.locations, stay_id=detail_id)
    await sync_stay_generated_points(db, stay=rec)
    await db.commit()
    await db.refresh(rec)
    locs = await _detail_locations(db, stay_id=detail_id)
    return stay_to_response(rec, locs)


@router.get("/stay-details/{stay_detail_id}", response_model=StayDetail)
async def get_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), user)
    rec = await db.get(StayDetailRecord, stay_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay detail not found")
    locs = await _detail_locations(db, stay_id=stay_detail_id)
    return stay_to_response(rec, locs)


@router.patch("/stay-details/{stay_detail_id}", response_model=StayDetail)
async def patch_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    body: StayDetailPatch,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip = await db.get(TripRecord, trip_id)
    _require_trip(trip, user)
    rec = await db.get(StayDetailRecord, stay_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay detail not found")

    field_map = {
        "name": "name",
        "stayType": "stay_type",
        "checkIn": "check_in",
        "checkOut": "check_out",
        "roomType": "room_type",
        "confirmationNumber": "confirmation_number",
        "description": "description",
    }
    for pydantic_field, orm_field in field_map.items():
        if pydantic_field in body.model_fields_set:
            setattr(rec, orm_field, getattr(body, pydantic_field))

    current_check_in_text = (
        body.checkIn
        if "checkIn" in body.model_fields_set
        else (wall_clock_to_text(rec.check_in_local) or rec.check_in)
    )
    current_check_out_text = (
        body.checkOut
        if "checkOut" in body.model_fields_set
        else (wall_clock_to_text(rec.check_out_local) or rec.check_out)
    )

    locations_for_inference = body.locations if "locations" in body.model_fields_set else (
        await _detail_locations(db, stay_id=stay_detail_id)
    )

    check_in_tzid = (
        body.checkInTimezoneId
        if "checkInTimezoneId" in body.model_fields_set
        else rec.check_in_tzid
    ) or _infer_tzid_from_locations(locations_for_inference, role="venue", fallback=trip.default_timezone_id)

    check_out_tzid = (
        body.checkOutTimezoneId
        if "checkOutTimezoneId" in body.model_fields_set
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
    return stay_to_response(rec, locs)


@router.delete("/stay-details/{stay_detail_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), user)
    rec = await db.get(StayDetailRecord, stay_detail_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay detail not found")

    rec.is_deleted = True
    rec.deleted_at = datetime.now(timezone.utc)
    rec.updated_at = datetime.now(timezone.utc)
    await soft_delete_generated_points_for_stay(db, stay_detail_id=stay_detail_id)
    await db.commit()
