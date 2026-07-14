from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import active, deleted, TripDayRecord, TripRecord
from app.schemas import TripDayCreate, TripDayPatch, TripDayResponse
from app.services import trip_write

router = APIRouter(
    prefix="/trips/{trip_id}/days",
    tags=["trip days"],
)


def _day_to_response(r: TripDayRecord) -> TripDayResponse:
    return TripDayResponse.from_record(r)


async def _require_day(db: AsyncSession, day_id: str, trip: TripRecord) -> TripDayRecord:
    day = await db.get(TripDayRecord, day_id)
    if day is None or day.is_deleted or day.deleted_at is not None or day.trip_id != trip.trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    return day


@router.get("", response_model=list[TripDayResponse])
async def list_days(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TripDayRecord)
        .where(
            TripDayRecord.trip_id == trip.trip_id,
            active(TripDayRecord),
        )
        .order_by(TripDayRecord.date, TripDayRecord.is_alternate)
    )
    return [_day_to_response(d) for d in result.scalars().all()]


@router.get("/deleted", response_model=list[TripDayResponse])
async def list_deleted_days(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TripDayRecord)
        .where(
            TripDayRecord.trip_id == trip.trip_id,
            deleted(TripDayRecord),
        )
        .order_by(TripDayRecord.date, TripDayRecord.is_alternate)
    )
    return [_day_to_response(d) for d in result.scalars().all()]



@router.post("", response_model=TripDayResponse, status_code=status.HTTP_201_CREATED)
async def create_day(
    body: TripDayCreate,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    if await db.get(TripDayRecord, body.day_id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day already exists")
    # adopt_existing=False: a REST client that POSTs onto a date which already has
    # a day gets a 409. (The assistant means "name this date", so it adopts — same
    # rule, different way of surfacing the collision. See trip_write.create_day.)
    result = await trip_write.create_day(db, trip, body, adopt_existing=False)
    await db.commit()
    await db.refresh(result.record)
    return _day_to_response(result.record)


@router.patch("/{day_id}", response_model=TripDayResponse)
async def patch_day(
    day_id: str,
    body: TripDayPatch,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    day = await _require_day(db, day_id, trip)
    await trip_write.update_day(db, trip, day, body)
    await db.commit()
    await db.refresh(day)
    return _day_to_response(day)


@router.delete("/{day_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_day(
    day_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    day = await _require_day(db, day_id, trip)
    await trip_write.delete_day(db, trip, day)
    await db.commit()


@router.post("/{day_id}/restore", response_model=TripDayResponse)
async def restore_day(
    day_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    day = await db.get(TripDayRecord, day_id)
    if day is None or day.trip_id != trip.trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    if day.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day is not deleted")
    day.is_deleted = False
    day.deleted_at = None
    await db.commit()
    await db.refresh(day)
    return _day_to_response(day)
