"""CRUD endpoints for travel and stay details as first-class trip entities.

Stays and travels live directly under a trip (siblings of days). Timeline points
(check-in/check-out, departure/arrival) reference them by ID. These endpoints let
clients create, list, read, update, and delete them directly, including their
own locations.
"""

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

router = APIRouter(prefix="/trips/{trip_id}", tags=["trip details"])


def _require_trip(trip: TripRecord | None, user: UserRecord) -> None:
    if trip is None or trip.user_id != str(user.id):
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
            )
        )


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
            TravelDetailRecord.trip_id == trip_id, TravelDetailRecord.deleted_at.is_(None)
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
    _require_trip(await db.get(TripRecord, trip_id), user)
    detail_id = body.travelDetailId or str(uuid.uuid4())
    rec = TravelDetailRecord(
        travel_detail_id=detail_id,
        trip_id=trip_id,
        name=body.name,
        mode=body.mode,
        operator=body.operator,
        vehicle_number=body.vehicleNumber,
        cabin_class=body.cabinClass,
        departure_date_time=body.departureDateTime,
        arrival_date_time=body.arrivalDateTime,
        confirmation_number=body.confirmationNumber,
        description=body.description,
    )
    db.add(rec)
    await db.flush()
    await _replace_detail_locations(db, body.locations, travel_id=detail_id)
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
    if rec is None or rec.trip_id != trip_id:
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
    _require_trip(await db.get(TripRecord, trip_id), user)
    rec = await db.get(TravelDetailRecord, travel_detail_id)
    if rec is None or rec.trip_id != trip_id:
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

    if "locations" in body.model_fields_set:
        await _replace_detail_locations(db, body.locations or [], travel_id=travel_detail_id)

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
    if rec is None or rec.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel detail not found")

    # Explicitly detach referenced points before deleting the detail. This keeps
    # timeline points intact even if DB-level ON DELETE behavior differs.
    await db.execute(
        update(TripPointRecord)
        .where(
            TripPointRecord.trip_id == trip_id,
            TripPointRecord.travel_detail_id == travel_detail_id,
        )
        .values(travel_detail_id=None)
    )

    await db.delete(rec)
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
            StayDetailRecord.trip_id == trip_id, StayDetailRecord.deleted_at.is_(None)
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
    _require_trip(await db.get(TripRecord, trip_id), user)
    detail_id = body.stayDetailId or str(uuid.uuid4())
    rec = StayDetailRecord(
        stay_detail_id=detail_id,
        trip_id=trip_id,
        name=body.name,
        stay_type=body.stayType,
        check_in=body.checkIn,
        check_out=body.checkOut,
        room_type=body.roomType,
        confirmation_number=body.confirmationNumber,
        description=body.description,
    )
    db.add(rec)
    await db.flush()
    await _replace_detail_locations(db, body.locations, stay_id=detail_id)
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
    if rec is None or rec.trip_id != trip_id:
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
    _require_trip(await db.get(TripRecord, trip_id), user)
    rec = await db.get(StayDetailRecord, stay_detail_id)
    if rec is None or rec.trip_id != trip_id:
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

    if "locations" in body.model_fields_set:
        await _replace_detail_locations(db, body.locations or [], stay_id=stay_detail_id)

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
    if rec is None or rec.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay detail not found")

    # Explicitly detach referenced points before deleting the detail. This keeps
    # timeline points intact even if DB-level ON DELETE behavior differs.
    await db.execute(
        update(TripPointRecord)
        .where(
            TripPointRecord.trip_id == trip_id,
            TripPointRecord.stay_detail_id == stay_detail_id,
        )
        .values(stay_detail_id=None)
    )

    await db.delete(rec)
    await db.commit()
