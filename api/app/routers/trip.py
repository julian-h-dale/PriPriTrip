from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.dependencies import get_owned_trip
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
    StayDetail,
    TravelDetail,
    TripDayWithPoints,
    TripHeader,
    TripHeaderResponse,
    TripListItem,
    TripPointResponse,
    TripResponse,
    VerifyResult,
)
from app.services.trip_verify import verify_trip

router = APIRouter(prefix="/trips", tags=["trips"])


@router.get("", response_model=list[TripListItem])
async def list_trips(
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    result = await db.execute(
        select(TripRecord)
        .where(
            TripRecord.user_id == str(user.id),
            TripRecord.is_deleted.is_(False),
            TripRecord.deleted_at.is_(None),
        )
        .order_by(TripRecord.start_date)
    )
    records = result.scalars().all()
    return [TripListItem.model_validate(r) for r in records]


@router.get("/{trip_id}", response_model=TripResponse)
async def get_trip(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    return await _load_trip(trip, db)


async def _load_trip(
    record: TripRecord,
    db: AsyncSession,
) -> TripResponse:
    trip_id = record.trip_id

    # ── Trip-level stays & travels (with their own locations) ────────────────
    stays_result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip_id,
            StayDetailRecord.is_deleted.is_(False),
            StayDetailRecord.deleted_at.is_(None),
        )
    )
    stay_records = stays_result.scalars().all()
    travels_result = await db.execute(
        select(TravelDetailRecord).where(
            TravelDetailRecord.trip_id == trip_id,
            TravelDetailRecord.is_deleted.is_(False),
            TravelDetailRecord.deleted_at.is_(None),
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
        s.stay_detail_id: StayDetail.from_record(s, locs_by_stay.get(s.stay_detail_id, []))
        for s in stay_records
    }
    travels = {
        t.travel_detail_id: TravelDetail.from_record(t, locs_by_travel.get(t.travel_detail_id, []))
        for t in travel_records
    }

    # ── Days & points ────────────────────────────────────────────────────────
    days_result = await db.execute(
        select(TripDayRecord)
        .where(
            TripDayRecord.trip_id == trip_id,
            TripDayRecord.is_deleted.is_(False),
            TripDayRecord.deleted_at.is_(None),
        )
        .order_by(TripDayRecord.date, TripDayRecord.is_alternate)
    )
    days = days_result.scalars().all()
    day_ids = [d.day_id for d in days]

    points = []
    if day_ids:
        pts_result = await db.execute(
            select(TripPointRecord)
            .where(
                TripPointRecord.day_id.in_(day_ids),
                TripPointRecord.is_deleted.is_(False),
                TripPointRecord.deleted_at.is_(None),
            )
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
        TripDayWithPoints.from_record(
            d,
            points=[
                TripPointResponse.from_record(
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
        trip_id=record.trip_id,
        trip_name=record.trip_name,
        status=record.status,
        start_location_name=record.start_location_name,
        destination_location_name=record.destination_location_name,
        default_timezone_id=record.default_timezone_id,
        start_date=record.start_date,
        end_date=record.end_date,
        stays=list(stays.values()),
        travels=list(travels.values()),
        days=assembled_days,
    )


@router.get("/{trip_id}/verify", response_model=VerifyResult)
async def verify_trip_endpoint(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    assembled = await _load_trip(trip, db)
    return verify_trip(assembled)


@router.put("/{trip_id}", response_model=TripHeaderResponse, status_code=status.HTTP_200_OK)
async def upsert_trip(
    trip_id: str,
    body: TripHeader,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    # The path is authoritative; body.tripId is still accepted but ignored.
    record = await db.get(TripRecord, trip_id)
    if record is None:
        record = TripRecord(
            trip_id=trip_id,
            user_id=str(user.id),
            trip_name=body.trip_name,
            start_location_name=body.start_location_name,
            destination_location_name=body.destination_location_name,
            default_timezone_id=body.default_timezone_id,
            start_date=body.start_date,
            end_date=body.end_date,
        )
        db.add(record)
    else:
        if record.user_id != str(user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        if bool(record.is_deleted) or record.deleted_at is not None:
            record.is_deleted = False
            record.deleted_at = None
        record.trip_name = body.trip_name
        record.start_location_name = body.start_location_name
        record.destination_location_name = body.destination_location_name
        record.default_timezone_id = body.default_timezone_id
        record.start_date = body.start_date
        record.end_date = body.end_date
        record.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return TripHeaderResponse(
        trip_id=record.trip_id,
        trip_name=record.trip_name,
        start_date=record.start_date,
        end_date=record.end_date,
        status=record.status or "new",
    )


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    trip_id = trip.trip_id
    now = datetime.now(timezone.utc)
    trip.is_deleted = True
    trip.deleted_at = now
    trip.updated_at = now

    travel_result = await db.execute(
        select(TravelDetailRecord).where(
            TravelDetailRecord.trip_id == trip_id,
            TravelDetailRecord.is_deleted.is_(False),
            TravelDetailRecord.deleted_at.is_(None),
        )
    )
    for travel in travel_result.scalars().all():
        travel.is_deleted = True
        travel.deleted_at = now
        travel.updated_at = now

    stay_result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip_id,
            StayDetailRecord.is_deleted.is_(False),
            StayDetailRecord.deleted_at.is_(None),
        )
    )
    for stay in stay_result.scalars().all():
        stay.is_deleted = True
        stay.deleted_at = now
        stay.updated_at = now

    point_result = await db.execute(
        select(TripPointRecord).where(
            TripPointRecord.trip_id == trip_id,
            TripPointRecord.is_deleted.is_(False),
            TripPointRecord.deleted_at.is_(None),
        )
    )
    for point in point_result.scalars().all():
        point.is_deleted = True
        point.deleted_at = now
        point.updated_at = now

    day_result = await db.execute(
        select(TripDayRecord).where(
            TripDayRecord.trip_id == trip_id,
            TripDayRecord.is_deleted.is_(False),
            TripDayRecord.deleted_at.is_(None),
        )
    )
    for day in day_result.scalars().all():
        day.is_deleted = True
        day.deleted_at = now
        day.updated_at = now

    await db.commit()
