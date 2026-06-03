import hmac
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import make_token, require_auth
from app.database import get_db
from app.models import TripItemRecord, TripRecord
from app.schemas import TripHeader, TripItemResponse, TripResponse

router = APIRouter(prefix="/trip", tags=["trip"])


def _get_trip(db: Session) -> TripRecord:
    record = db.query(TripRecord).order_by(TripRecord.updated_at.desc()).first()
    if record is None:
        raise ValueError("No trip found")
    return record


def _item_to_response(r: TripItemRecord) -> TripItemResponse:
    return TripItemResponse(
        itemId=r.item_id,
        tripId=r.trip_id,
        parentItemId=r.parent_item_id,
        kind=r.kind,
        title=r.title,
        startDateTime=r.start_date_time,
        endDateTime=r.end_date_time,
        sortOrder=r.sort_order,
        confirmationNumber=r.confirmation_number,
        type=r.type,
        subtype=r.subtype,
        description=r.description,
        imageUrl=r.image_url,
        logoUrl=r.logo_url,
        locations=r.locations or [],
        completed=r.completed,
        completedDateTime=r.completed_date_time,
        deletedAt=r.deleted_at.isoformat() if r.deleted_at else None,
        createdAt=r.created_at.isoformat() if r.created_at else None,
        updatedAt=r.updated_at.isoformat() if r.updated_at else None,
    )


@router.get("", dependencies=[Depends(require_auth)], response_model=TripResponse)
async def get_trip(db: Session = Depends(get_db)):
    try:
        record = _get_trip(db)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No trip found")
    except Exception as exc:
        logging.error("GET /trip error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to read trip"
        )

    items = (
        db.query(TripItemRecord)
        .filter(TripItemRecord.trip_id == record.trip_id, TripItemRecord.deleted_at.is_(None))
        .order_by(TripItemRecord.sort_order)
        .all()
    )
    return TripResponse(
        tripId=record.trip_id,
        tripName=record.trip_name,
        startDate=record.start_date,
        endDate=record.end_date,
        items=[_item_to_response(i) for i in items],
    )


@router.post("", dependencies=[Depends(require_auth)])
async def upsert_trip(body: TripHeader, db: Session = Depends(get_db)):
    try:
        from datetime import datetime, timezone

        record = db.get(TripRecord, body.tripId)
        if record is None:
            db.add(
                TripRecord(
                    trip_id=body.tripId,
                    trip_name=body.tripName,
                    start_date=body.startDate,
                    end_date=body.endDate,
                )
            )
        else:
            record.trip_name = body.tripName
            record.start_date = body.startDate
            record.end_date = body.endDate
            record.updated_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "ok"}
    except Exception as exc:
        logging.error("POST /trip error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to write trip"
        )
