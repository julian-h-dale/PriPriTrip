from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.database import get_db
from app.models import TripDayRecord, TripRecord
from app.schemas import TripDayCreate, TripDayPatch, TripDayResponse, TripDayUpdate

router = APIRouter(
    prefix="/trips/{trip_id}/days",
    tags=["trip days"],
    dependencies=[Depends(require_auth)],
)


def _day_to_response(r: TripDayRecord) -> TripDayResponse:
    return TripDayResponse(
        dayId=r.day_id,
        tripId=r.trip_id,
        title=r.title,
        date=r.date,
        description=r.description,
        sortOrder=r.sort_order,
        isAlternate=r.is_alternate,
        completed=r.completed,
        deletedAt=r.deleted_at.isoformat() if r.deleted_at else None,
        createdAt=r.created_at.isoformat() if r.created_at else None,
        updatedAt=r.updated_at.isoformat() if r.updated_at else None,
    )


def _require_trip(trip_id: str, db: Session) -> TripRecord:
    record = db.get(TripRecord, trip_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return record


@router.get("", response_model=list[TripDayResponse])
async def list_days(trip_id: str, db: Session = Depends(get_db)):
    _require_trip(trip_id, db)
    days = (
        db.query(TripDayRecord)
        .filter(TripDayRecord.trip_id == trip_id, TripDayRecord.deleted_at.is_(None))
        .order_by(TripDayRecord.sort_order)
        .all()
    )
    return [_day_to_response(d) for d in days]


@router.get("/deleted", response_model=list[TripDayResponse])
async def list_deleted_days(trip_id: str, db: Session = Depends(get_db)):
    _require_trip(trip_id, db)
    days = (
        db.query(TripDayRecord)
        .filter(TripDayRecord.trip_id == trip_id, TripDayRecord.deleted_at.isnot(None))
        .order_by(TripDayRecord.sort_order)
        .all()
    )
    return [_day_to_response(d) for d in days]


@router.post("", response_model=TripDayResponse, status_code=status.HTTP_201_CREATED)
async def create_day(trip_id: str, body: TripDayCreate, db: Session = Depends(get_db)):
    _require_trip(trip_id, db)
    if db.get(TripDayRecord, body.dayId) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day already exists")
    day = TripDayRecord(
        day_id=body.dayId,
        trip_id=trip_id,
        title=body.title,
        date=body.date,
        description=body.description,
        sort_order=body.sortOrder,
        is_alternate=body.isAlternate,
        completed=body.completed,
    )
    db.add(day)
    db.commit()
    db.refresh(day)
    return _day_to_response(day)


@router.put("/{day_id}", response_model=TripDayResponse)
async def update_day(trip_id: str, day_id: str, body: TripDayUpdate, db: Session = Depends(get_db)):
    day = db.get(TripDayRecord, day_id)
    if day is None or day.deleted_at is not None or day.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    day.title = body.title
    day.date = body.date
    day.description = body.description
    day.sort_order = body.sortOrder
    day.is_alternate = body.isAlternate
    day.completed = body.completed
    day.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(day)
    return _day_to_response(day)


@router.patch("/{day_id}", response_model=TripDayResponse)
async def patch_day(trip_id: str, day_id: str, body: TripDayPatch, db: Session = Depends(get_db)):
    day = db.get(TripDayRecord, day_id)
    if day is None or day.deleted_at is not None or day.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    _field_map = {
        "title": "title",
        "date": "date",
        "description": "description",
        "sortOrder": "sort_order",
        "isAlternate": "is_alternate",
        "completed": "completed",
    }
    for pydantic_field, orm_field in _field_map.items():
        if pydantic_field in body.model_fields_set:
            setattr(day, orm_field, getattr(body, pydantic_field))
    day.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(day)
    return _day_to_response(day)


@router.delete("/{day_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_day(trip_id: str, day_id: str, db: Session = Depends(get_db)):
    day = db.get(TripDayRecord, day_id)
    if day is None or day.deleted_at is not None or day.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    day.deleted_at = datetime.now(timezone.utc)
    day.updated_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/{day_id}/restore", response_model=TripDayResponse)
async def restore_day(trip_id: str, day_id: str, db: Session = Depends(get_db)):
    day = db.get(TripDayRecord, day_id)
    if day is None or day.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    if day.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day is not deleted")
    day.deleted_at = None
    day.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(day)
    return _day_to_response(day)
