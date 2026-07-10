from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import TripDayRecord, TripRecord, UserRecord
from app.schemas import TripDayCreate, TripDayPatch, TripDayResponse, TripDayUpdate

router = APIRouter(
    prefix="/trips/{trip_id}/days",
    tags=["trip days"],
)


def _day_to_response(r: TripDayRecord) -> TripDayResponse:
    return TripDayResponse(
        dayId=r.day_id,
        tripId=r.trip_id,
        title=r.title,
        date=r.date,
        description=r.description,
        isAlternate=r.is_alternate,
        completed=r.completed,
        deletedAt=r.deleted_at.isoformat() if r.deleted_at else None,
        createdAt=r.created_at.isoformat() if r.created_at else None,
        updatedAt=r.updated_at.isoformat() if r.updated_at else None,
    )


def _require_trip(trip_id: str, trip: TripRecord | None, user: UserRecord) -> TripRecord:
    if (
        trip is None
        or trip.user_id != str(user.id)
        or bool(getattr(trip, "is_deleted", False))
        or getattr(trip, "deleted_at", None) is not None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


@router.get("", response_model=list[TripDayResponse])
async def list_days(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(trip_id, await db.get(TripRecord, trip_id), user)
    result = await db.execute(
        select(TripDayRecord)
        .where(
            TripDayRecord.trip_id == trip_id,
            TripDayRecord.is_deleted.is_(False),
            TripDayRecord.deleted_at.is_(None),
        )
        .order_by(TripDayRecord.date, TripDayRecord.is_alternate)
    )
    return [_day_to_response(d) for d in result.scalars().all()]


@router.get("/deleted", response_model=list[TripDayResponse])
async def list_deleted_days(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(trip_id, await db.get(TripRecord, trip_id), user)
    result = await db.execute(
        select(TripDayRecord)
        .where(
            TripDayRecord.trip_id == trip_id,
            TripDayRecord.is_deleted.is_(True),
            TripDayRecord.deleted_at.isnot(None),
        )
        .order_by(TripDayRecord.date, TripDayRecord.is_alternate)
    )
    return [_day_to_response(d) for d in result.scalars().all()]


@router.post("", response_model=TripDayResponse, status_code=status.HTTP_201_CREATED)
async def create_day(
    trip_id: str,
    body: TripDayCreate,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(trip_id, await db.get(TripRecord, trip_id), user)
    if await db.get(TripDayRecord, body.dayId) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day already exists")
    day = TripDayRecord(
        day_id=body.dayId,
        trip_id=trip_id,
        title=body.title,
        date=body.date,
        description=body.description,
        is_alternate=body.isAlternate,
        completed=body.completed,
    )
    db.add(day)
    await db.commit()
    await db.refresh(day)
    return _day_to_response(day)


@router.put("/{day_id}", response_model=TripDayResponse)
async def update_day(
    trip_id: str,
    day_id: str,
    body: TripDayUpdate,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    day = await db.get(TripDayRecord, day_id)
    if day is None or day.is_deleted or day.deleted_at is not None or day.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    trip = await db.get(TripRecord, trip_id)
    _require_trip(trip_id, trip, user)
    day.title = body.title
    day.date = body.date
    day.description = body.description
    day.is_alternate = body.isAlternate
    day.completed = body.completed
    day.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(day)
    return _day_to_response(day)


@router.patch("/{day_id}", response_model=TripDayResponse)
async def patch_day(
    trip_id: str,
    day_id: str,
    body: TripDayPatch,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    day = await db.get(TripDayRecord, day_id)
    if day is None or day.is_deleted or day.deleted_at is not None or day.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    trip = await db.get(TripRecord, trip_id)
    _require_trip(trip_id, trip, user)
    _field_map = {
        "title": "title",
        "date": "date",
        "description": "description",
        "isAlternate": "is_alternate",
        "completed": "completed",
    }
    for pydantic_field, orm_field in _field_map.items():
        if pydantic_field in body.model_fields_set:
            setattr(day, orm_field, getattr(body, pydantic_field))
    day.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(day)
    return _day_to_response(day)


@router.delete("/{day_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_day(
    trip_id: str,
    day_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    day = await db.get(TripDayRecord, day_id)
    if day is None or day.is_deleted or day.deleted_at is not None or day.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    trip = await db.get(TripRecord, trip_id)
    _require_trip(trip_id, trip, user)
    day.is_deleted = True
    day.deleted_at = datetime.now(timezone.utc)
    day.updated_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{day_id}/restore", response_model=TripDayResponse)
async def restore_day(
    trip_id: str,
    day_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    day = await db.get(TripDayRecord, day_id)
    if day is None or day.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    trip = await db.get(TripRecord, trip_id)
    _require_trip(trip_id, trip, user)
    if day.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day is not deleted")
    day.is_deleted = False
    day.deleted_at = None
    day.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(day)
    return _day_to_response(day)
