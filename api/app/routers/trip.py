import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    UserRecord,
)
from app.schemas import (
    TripDayWithPoints,
    TripHeader,
    TripListItem,
    TripResponse,
    VerifyResult,
)
from app.serializers import point_to_response, stay_to_response, travel_to_response
from app.services.trip_verify import verify_trip

router = APIRouter(prefix="/trips", tags=["trips"])


@router.get("", response_model=list[TripListItem])
async def list_trips(
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    result = await db.execute(
        select(TripRecord)
        .where(TripRecord.user_id == str(user.id))
        .order_by(TripRecord.start_date)
    )
    records = result.scalars().all()
    return [
        TripListItem(
            tripId=r.trip_id,
            tripName=r.trip_name,
            startDate=r.start_date,
            endDate=r.end_date,
        )
        for r in records
    ]


@router.get("/{trip_id}", response_model=TripResponse)
async def get_trip(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    return await _load_trip(trip_id, db, user)


async def _load_trip(
    trip_id: str,
    db: AsyncSession,
    user: UserRecord,
) -> TripResponse:
    record = await db.get(TripRecord, trip_id)
    if record is None or record.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    # ── Trip-level stays & travels (with their own locations) ────────────────
    stays_result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip_id, StayDetailRecord.deleted_at.is_(None)
        )
    )
    stay_records = stays_result.scalars().all()
    travels_result = await db.execute(
        select(TravelDetailRecord).where(
            TravelDetailRecord.trip_id == trip_id, TravelDetailRecord.deleted_at.is_(None)
        )
    )
    travel_records = travels_result.scalars().all()

    locs_by_stay: dict = {}
    locs_by_travel: dict = {}
    locs_by_point: dict = {}

    stay_ids = [s.stay_detail_id for s in stay_records]
    travel_ids = [t.travel_detail_id for t in travel_records]

    if stay_ids:
        res = await db.execute(
            select(LocationRecord).where(LocationRecord.stay_detail_id.in_(stay_ids))
        )
        for loc in res.scalars().all():
            locs_by_stay.setdefault(loc.stay_detail_id, []).append(loc)
    if travel_ids:
        res = await db.execute(
            select(LocationRecord).where(LocationRecord.travel_detail_id.in_(travel_ids))
        )
        for loc in res.scalars().all():
            locs_by_travel.setdefault(loc.travel_detail_id, []).append(loc)

    stays = {
        s.stay_detail_id: stay_to_response(s, locs_by_stay.get(s.stay_detail_id, []))
        for s in stay_records
    }
    travels = {
        t.travel_detail_id: travel_to_response(t, locs_by_travel.get(t.travel_detail_id, []))
        for t in travel_records
    }

    # ── Days & points ────────────────────────────────────────────────────────
    days_result = await db.execute(
        select(TripDayRecord)
        .where(TripDayRecord.trip_id == trip_id, TripDayRecord.deleted_at.is_(None))
        .order_by(TripDayRecord.date, TripDayRecord.is_alternate)
    )
    days = days_result.scalars().all()
    day_ids = [d.day_id for d in days]

    points = []
    if day_ids:
        pts_result = await db.execute(
            select(TripPointRecord)
            .where(TripPointRecord.day_id.in_(day_ids), TripPointRecord.deleted_at.is_(None))
            .order_by(TripPointRecord.start_date_time)
        )
        points = pts_result.scalars().all()
        point_ids = [p.point_id for p in points]

        if point_ids:
            loc_result = await db.execute(
                select(LocationRecord).where(LocationRecord.point_id.in_(point_ids))
            )
            for loc in loc_result.scalars().all():
                locs_by_point.setdefault(loc.point_id, []).append(loc)

    points_by_day: dict = {}
    for p in points:
        points_by_day.setdefault(p.day_id, []).append(p)

    assembled_days = [
        TripDayWithPoints(
            dayId=d.day_id,
            tripId=d.trip_id,
            title=d.title,
            date=d.date,
            description=d.description,
            isAlternate=d.is_alternate,
            completed=d.completed,
            deletedAt=d.deleted_at.isoformat() if d.deleted_at else None,
            createdAt=d.created_at.isoformat() if d.created_at else None,
            updatedAt=d.updated_at.isoformat() if d.updated_at else None,
            points=[
                point_to_response(
                    p,
                    locs_by_point.get(p.point_id, []),
                    travels.get(p.travel_detail_id) if p.travel_detail_id else None,
                    stays.get(p.stay_detail_id) if p.stay_detail_id else None,
                )
                for p in points_by_day.get(d.day_id, [])
            ],
        )
        for d in days
    ]

    return TripResponse(
        tripId=record.trip_id,
        tripName=record.trip_name,
        startDate=record.start_date,
        endDate=record.end_date,
        stays=list(stays.values()),
        travels=list(travels.values()),
        days=assembled_days,
    )


@router.get("/{trip_id}/verify", response_model=VerifyResult)
async def verify_trip_endpoint(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip = await _load_trip(trip_id, db, user)
    return verify_trip(trip)


@router.post("", status_code=status.HTTP_200_OK)
async def upsert_trip(
    body: TripHeader,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    try:
        record = await db.get(TripRecord, body.tripId)
        if record is None:
            db.add(
                TripRecord(
                    trip_id=body.tripId,
                    user_id=str(user.id),
                    trip_name=body.tripName,
                    start_date=body.startDate,
                    end_date=body.endDate,
                )
            )
        else:
            if record.user_id != str(user.id):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
            record.trip_name = body.tripName
            record.start_date = body.startDate
            record.end_date = body.endDate
            record.updated_at = datetime.now(timezone.utc)
        await db.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        logging.error("POST /trips error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save trip"
        )


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip = await db.get(TripRecord, trip_id)
    if trip is None or trip.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    # Delete in FK order: locations → travel/stay details → points → days → trip
    point_ids_result = await db.execute(
        select(TripPointRecord.point_id).where(TripPointRecord.trip_id == trip_id)
    )
    point_ids = list(point_ids_result.scalars().all())

    if point_ids:
        await db.execute(delete(LocationRecord).where(LocationRecord.point_id.in_(point_ids)))
        await db.execute(delete(TravelDetailRecord).where(TravelDetailRecord.point_id.in_(point_ids)))
        await db.execute(delete(StayDetailRecord).where(StayDetailRecord.point_id.in_(point_ids)))

    await db.execute(delete(TripPointRecord).where(TripPointRecord.trip_id == trip_id))
    await db.execute(delete(TripDayRecord).where(TripDayRecord.trip_id == trip_id))
    await db.delete(trip)
    await db.commit()
