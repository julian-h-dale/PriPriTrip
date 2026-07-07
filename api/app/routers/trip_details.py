"""Standalone read + patch endpoints for travel and stay details.

Details are still *created* via the point endpoints; these routes let clients
list all travel/stay details in a trip and patch a single one directly by its
own ID without having to round-trip the whole point.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import (
    StayDetailRecord,
    TravelDetailRecord,
    TripRecord,
    UserRecord,
)
from app.schemas import StayDetail, StayDetailPatch, TravelDetail, TravelDetailPatch

router = APIRouter(prefix="/trips/{trip_id}", tags=["trip details"])


def _require_trip(trip: TripRecord | None, user: UserRecord) -> None:
    if trip is None or trip.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")


def _travel_to_response(rec: TravelDetailRecord) -> TravelDetail:
    return TravelDetail(
        travelDetailId=rec.travel_detail_id,
        tripId=rec.trip_id,
        pointId=rec.point_id,
        mode=rec.mode,
        operator=rec.operator,
        vehicleNumber=rec.vehicle_number,
        cabinClass=rec.cabin_class,
    )


def _stay_to_response(rec: StayDetailRecord) -> StayDetail:
    return StayDetail(
        stayDetailId=rec.stay_detail_id,
        tripId=rec.trip_id,
        pointId=rec.point_id,
        stayType=rec.stay_type,
        checkInTime=rec.check_in_time,
        checkOutTime=rec.check_out_time,
        roomType=rec.room_type,
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
        select(TravelDetailRecord).where(TravelDetailRecord.trip_id == trip_id)
    )
    return [_travel_to_response(r) for r in result.scalars().all()]


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
    return _travel_to_response(rec)


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
        "mode": "mode",
        "operator": "operator",
        "vehicleNumber": "vehicle_number",
        "cabinClass": "cabin_class",
    }
    for pydantic_field, orm_field in field_map.items():
        if pydantic_field in body.model_fields_set:
            setattr(rec, orm_field, getattr(body, pydantic_field))

    await db.commit()
    await db.refresh(rec)
    return _travel_to_response(rec)


# ── Stay details ──────────────────────────────────────────────────────────

@router.get("/stay-details", response_model=list[StayDetail])
async def list_stay_details(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), user)
    result = await db.execute(
        select(StayDetailRecord).where(StayDetailRecord.trip_id == trip_id)
    )
    return [_stay_to_response(r) for r in result.scalars().all()]


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
    return _stay_to_response(rec)


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
        "stayType": "stay_type",
        "checkInTime": "check_in_time",
        "checkOutTime": "check_out_time",
        "roomType": "room_type",
    }
    for pydantic_field, orm_field in field_map.items():
        if pydantic_field in body.model_fields_set:
            setattr(rec, orm_field, getattr(body, pydantic_field))

    await db.commit()
    await db.refresh(rec)
    return _stay_to_response(rec)
