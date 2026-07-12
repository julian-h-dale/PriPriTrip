from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import active, StayDetailRecord, TravelDetailRecord, TripDayRecord, TripPointRecord, TripRecord
from app.services.timezones import derive_utc, parse_wall_clock, wall_clock_to_text


CHECK_IN_DEFAULT_TIME = "16:00"
CHECK_OUT_DEFAULT_TIME = "11:00"


def normalize_stay_wall_clock(value: str | None, *, default_time: str) -> str | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if "T" not in text:
        return f"{text}T{default_time}"
    return text


async def _get_or_create_day_for_date(db: AsyncSession, *, trip_id: str, day_date: date) -> TripDayRecord:
    result = await db.execute(
        select(TripDayRecord).where(
            TripDayRecord.trip_id == trip_id,
            TripDayRecord.date == day_date,
            active(TripDayRecord),
        )
    )
    day = result.scalars().all()
    if day:
        return day[0]

    date_text = day_date.isoformat()
    created = TripDayRecord(
        day_id=str(uuid.uuid4()),
        trip_id=trip_id,
        title=date_text,
        date=day_date,
        description=None,
        is_alternate=False,
        completed=False,
    )
    db.add(created)
    await db.flush()
    return created


async def _load_generated_points(
    db: AsyncSession,
    *,
    stay_detail_id: str | None = None,
    travel_detail_id: str | None = None,
) -> dict[str, TripPointRecord]:
    conditions = [
        TripPointRecord.is_system_created.is_(True),
    ]
    if stay_detail_id is not None:
        conditions.append(TripPointRecord.stay_detail_id == stay_detail_id)
    if travel_detail_id is not None:
        conditions.append(TripPointRecord.travel_detail_id == travel_detail_id)

    result = await db.execute(select(TripPointRecord).where(*conditions))
    return {point.type: point for point in result.scalars().all()}


async def _soft_delete_point(point: TripPointRecord) -> None:
    point.is_deleted = True
    point.deleted_at = datetime.now(timezone.utc)


async def sync_travel_generated_points(
    db: AsyncSession,
    *,
    travel: TravelDetailRecord,
) -> None:
    existing = await _load_generated_points(db, travel_detail_id=travel.travel_detail_id)
    events = [
        ("departure", wall_clock_to_text(travel.departure_local), travel.departure_tzid),
        ("arrival", wall_clock_to_text(travel.arrival_local), travel.arrival_tzid),
    ]

    for point_type, time_text, tzid in events:
        point = existing.get(point_type)
        if not time_text:
            if point and point.deleted_at is None:
                await _soft_delete_point(point)
            continue

        local_dt = parse_wall_clock(time_text)
        if local_dt is None:
            continue
        day = await _get_or_create_day_for_date(db, trip_id=travel.trip_id, day_date=date.fromisoformat(time_text[:10]))
        title = f"{point_type.replace('-', ' ').title()}: {travel.name}" if travel.name else point_type.replace('-', ' ').title()

        if point is None:
            point = TripPointRecord(
                point_id=str(uuid.uuid4()),
                trip_id=travel.trip_id,
                day_id=day.day_id,
                type=point_type,
                title=title,
                stay_detail_id=None,
                travel_detail_id=travel.travel_detail_id,
                is_system_created=True,
                completed=False,
            )
            db.add(point)
        point.day_id = day.day_id
        point.title = title
        point.travel_detail_id = travel.travel_detail_id
        point.stay_detail_id = None
        point.start_local = local_dt
        point.start_tzid = tzid
        point.start_utc = derive_utc(local_dt, tzid)
        point.end_local = local_dt
        point.end_tzid = tzid
        point.end_utc = derive_utc(local_dt, tzid)
        point.confirmation_number = travel.confirmation_number
        point.description = None
        point.image_url = None
        point.logo_url = None
        point.is_system_created = True
        point.is_deleted = False
        point.deleted_at = None


async def sync_stay_generated_points(
    db: AsyncSession,
    *,
    stay: StayDetailRecord,
) -> None:
    existing = await _load_generated_points(db, stay_detail_id=stay.stay_detail_id)
    events = [
        ("check-in", wall_clock_to_text(stay.check_in_local), stay.check_in_tzid),
        ("check-out", wall_clock_to_text(stay.check_out_local), stay.check_out_tzid),
    ]

    for point_type, time_text, tzid in events:
        point = existing.get(point_type)
        if not time_text:
            if point and point.deleted_at is None:
                await _soft_delete_point(point)
            continue

        local_dt = parse_wall_clock(time_text)
        if local_dt is None:
            continue
        day = await _get_or_create_day_for_date(db, trip_id=stay.trip_id, day_date=date.fromisoformat(time_text[:10]))
        title = f"{point_type.replace('-', ' ').title()}: {stay.name}" if stay.name else point_type.replace('-', ' ').title()

        if point is None:
            point = TripPointRecord(
                point_id=str(uuid.uuid4()),
                trip_id=stay.trip_id,
                day_id=day.day_id,
                type=point_type,
                title=title,
                stay_detail_id=stay.stay_detail_id,
                travel_detail_id=None,
                is_system_created=True,
                completed=False,
            )
            db.add(point)
        point.day_id = day.day_id
        point.title = title
        point.stay_detail_id = stay.stay_detail_id
        point.travel_detail_id = None
        point.start_local = local_dt
        point.start_tzid = tzid
        point.start_utc = derive_utc(local_dt, tzid)
        point.end_local = local_dt
        point.end_tzid = tzid
        point.end_utc = derive_utc(local_dt, tzid)
        point.confirmation_number = stay.confirmation_number
        point.description = None
        point.image_url = None
        point.logo_url = None
        point.is_system_created = True
        point.is_deleted = False
        point.deleted_at = None


async def reconcile_trip_days(db: AsyncSession, trip: TripRecord) -> None:
    """Align the trip's day rows with its start/end date range.

    Creates missing days for every date in range; soft-deletes days that fell
    out of range and hold no points. Runs after any trip date change.
    """
    start, end = trip.start_date, trip.end_date
    if start is None or end is None or end < start:
        return

    existing_result = await db.execute(
        select(TripDayRecord).where(
            TripDayRecord.trip_id == trip.trip_id,
            active(TripDayRecord),
        )
    )
    existing_days = existing_result.scalars().all()
    existing_by_date = {day.date: day for day in existing_days}

    current = start
    desired_dates: set[date] = set()
    while current <= end:
        desired_dates.add(current)
        if current not in existing_by_date:
            db.add(
                TripDayRecord(
                    day_id=str(uuid.uuid4()),
                    trip_id=trip.trip_id,
                    title=current.isoformat(),
                    date=current,
                    description=None,
                    is_alternate=False,
                    completed=False,
                )
            )
        current += timedelta(days=1)

    if existing_days:
        points_result = await db.execute(
            select(TripPointRecord).where(
                TripPointRecord.trip_id == trip.trip_id,
                active(TripPointRecord),
            )
        )
        points_by_day: dict[str, list[TripPointRecord]] = {}
        for point in points_result.scalars().all():
            points_by_day.setdefault(point.day_id, []).append(point)

        for day in existing_days:
            if day.date in desired_dates:
                continue
            if points_by_day.get(day.day_id):
                continue
            day.is_deleted = True
            day.deleted_at = datetime.now(timezone.utc)

    await db.flush()


async def soft_delete_generated_points_for_travel(db: AsyncSession, *, travel_detail_id: str) -> None:
    points = (await _load_generated_points(db, travel_detail_id=travel_detail_id)).values()
    for point in points:
        if point.deleted_at is None:
            await _soft_delete_point(point)


async def soft_delete_generated_points_for_stay(db: AsyncSession, *, stay_detail_id: str) -> None:
    points = (await _load_generated_points(db, stay_detail_id=stay_detail_id)).values()
    for point in points:
        if point.deleted_at is None:
            await _soft_delete_point(point)
