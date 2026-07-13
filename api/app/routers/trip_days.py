from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import active, deleted, TripDayRecord, TripRecord
from app.schemas import TripDayCreate, TripDayPatch, TripDayResponse
from app.services.detail_points import primary_day_for_date

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


async def _reject_occupied_date(
    db: AsyncSession,
    trip: TripRecord,
    day_date,
    *,
    is_alternate: bool,
    moving: TripDayRecord | None = None,
) -> None:
    """One primary day per date (see detail_points.primary_day_for_date).

    Alternates are exempt — a second plan for the same date is the point of
    them. Everything else would put that date on the timeline twice.
    """
    if is_alternate or day_date is None:
        return
    clash = await primary_day_for_date(db, trip_id=trip.trip_id, day_date=day_date)
    if clash is None or (moving is not None and clash.day_id == moving.day_id):
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"{day_date.isoformat()} already has a day ({clash.title!r}). Edit that one, "
            f"or mark this an alternate if you mean a second plan for the same date."
        ),
    )


@router.post("", response_model=TripDayResponse, status_code=status.HTTP_201_CREATED)
async def create_day(
    body: TripDayCreate,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    if await db.get(TripDayRecord, body.day_id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day already exists")
    await _reject_occupied_date(db, trip, body.date, is_alternate=body.is_alternate)
    day = TripDayRecord(
        day_id=body.day_id,
        trip_id=trip.trip_id,
        title=body.title,
        date=body.date,
        description=body.description,
        is_alternate=body.is_alternate,
        completed=body.completed,
    )
    db.add(day)
    await db.commit()
    await db.refresh(day)
    return _day_to_response(day)


@router.patch("/{day_id}", response_model=TripDayResponse)
async def patch_day(
    day_id: str,
    body: TripDayPatch,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    day = await _require_day(db, day_id, trip)
    if "date" in body.model_fields_set and body.date != day.date:
        is_alternate = (
            body.is_alternate if "is_alternate" in body.model_fields_set else day.is_alternate
        )
        await _reject_occupied_date(db, trip, body.date, is_alternate=is_alternate, moving=day)
    # Field names match the ORM columns 1:1 now that schemas are snake_case.
    for field in ("title", "date", "description", "is_alternate", "completed"):
        if field in body.model_fields_set:
            setattr(day, field, getattr(body, field))
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
    day.is_deleted = True
    day.deleted_at = datetime.now(timezone.utc)
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
