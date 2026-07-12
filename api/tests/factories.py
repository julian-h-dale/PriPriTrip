"""Row builders for the real-database tests.

These insert genuine rows, so foreign keys, check constraints and NOT NULLs
all apply — which is the point of moving off the fake sessions (review.md 1C-3).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    UserRecord,
)


def new_id() -> str:
    return str(uuid.uuid4())


def as_date(value):
    """Tests write dates as text; the columns are real dates."""
    return date.fromisoformat(value) if isinstance(value, str) else value


def _soft_delete_fields(overrides: dict) -> dict:
    """A row is only 'deleted' when both fields agree.

    `active()`/`deleted()` check `is_deleted` AND `deleted_at`, so a factory
    that set only the flag would build a row the app considers neither live nor
    deleted. (Two fields encoding one fact — see review.md 1C-3.)
    """
    if overrides.get("is_deleted") and "deleted_at" not in overrides:
        overrides["deleted_at"] = datetime.now(timezone.utc)
    return overrides


async def make_trip(db: AsyncSession, user: UserRecord, **overrides) -> TripRecord:
    values = {
        "trip_id": new_id(),
        "user_id": str(user.id),
        "trip_name": "Okinawa Trip",
        "status": "draft",
        "start_date": date(2026, 10, 30),
        "end_date": date(2026, 11, 5),
        "is_deleted": False,
        "deleted_at": None,
    }
    values.update(_soft_delete_fields(overrides))
    values["start_date"] = as_date(values["start_date"])
    values["end_date"] = as_date(values["end_date"])
    trip = TripRecord(**values)
    db.add(trip)
    await db.commit()
    return trip


async def make_day(db: AsyncSession, trip: TripRecord, **overrides) -> TripDayRecord:
    values = {
        "day_id": new_id(),
        "trip_id": trip.trip_id,
        "title": "Arrival",
        "date": date(2026, 10, 30),
        "is_alternate": False,
        "completed": False,
        "is_deleted": False,
    }
    values.update(_soft_delete_fields(overrides))
    values["date"] = as_date(values["date"])
    day = TripDayRecord(**values)
    db.add(day)
    await db.commit()
    return day


async def make_point(db: AsyncSession, trip: TripRecord, day: TripDayRecord, **overrides) -> TripPointRecord:
    values = {
        "point_id": new_id(),
        "trip_id": trip.trip_id,
        "day_id": day.day_id,
        "type": "activity",
        "title": "Dinner at Giaxa",
        "is_system_created": False,
        "completed": False,
        "is_deleted": False,
    }
    values.update(_soft_delete_fields(overrides))
    point = TripPointRecord(**values)
    db.add(point)
    await db.commit()
    return point


async def make_stay(db: AsyncSession, trip: TripRecord, **overrides) -> StayDetailRecord:
    values = {
        "stay_detail_id": new_id(),
        "trip_id": trip.trip_id,
        "name": "Hyatt Regency Naha",
        "stay_type": "hotel",
        "is_deleted": False,
    }
    values.update(_soft_delete_fields(overrides))
    stay = StayDetailRecord(**values)
    db.add(stay)
    await db.commit()
    return stay


async def make_travel(db: AsyncSession, trip: TripRecord, **overrides) -> TravelDetailRecord:
    values = {
        "travel_detail_id": new_id(),
        "trip_id": trip.trip_id,
        "name": "Flight to Naha",
        "mode": "flight",
        "is_deleted": False,
    }
    values.update(_soft_delete_fields(overrides))
    travel = TravelDetailRecord(**values)
    db.add(travel)
    await db.commit()
    return travel


async def make_location(db: AsyncSession, *, point=None, stay=None, travel=None, **overrides) -> LocationRecord:
    """Exactly one owner — the check constraint enforces it for real now."""
    values = {
        "location_id": new_id(),
        "role": "venue",
        "name": "Naha",
        "sort_order": 0,
        "point_id": point.point_id if point else None,
        "stay_detail_id": stay.stay_detail_id if stay else None,
        "travel_detail_id": travel.travel_detail_id if travel else None,
    }
    values.update(overrides)
    location = LocationRecord(**values)
    db.add(location)
    await db.commit()
    return location
