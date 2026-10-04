"""Database-level guarantees the app relies on."""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Day, Item, Trip, UserRecord


async def _trip(db: AsyncSession, user: UserRecord) -> Trip:
    trip = Trip(
        user_id=user.id,
        name="T",
        start_date=dt.date(2026, 5, 10),
        end_date=dt.date(2026, 5, 12),
        timezone="Europe/Zurich",
    )
    db.add(trip)
    await db.commit()
    return trip


async def test_foreign_keys_are_enforced(db: AsyncSession) -> None:
    # SQLite ignores FKs unless the pragma is on for the connection.
    db.add(Item(day_id=uuid.uuid4(), position=0, title="orphan"))
    with pytest.raises(IntegrityError):
        await db.commit()


async def test_one_live_day_per_date(db: AsyncSession, test_user: UserRecord) -> None:
    trip_id = (await _trip(db, test_user)).id
    first = Day(trip_id=trip_id, date=dt.date(2026, 5, 11), title="A")
    db.add(first)
    await db.commit()

    db.add(Day(trip_id=trip_id, date=dt.date(2026, 5, 11), title="B"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()

    # A soft-deleted day frees its date. (Refresh first: the rollback expired
    # `first`, and touching an expired attribute would lazy-load synchronously.)
    await db.refresh(first)
    first.is_deleted = True
    await db.commit()
    db.add(Day(trip_id=trip_id, date=dt.date(2026, 5, 11), title="C"))
    await db.commit()


async def test_wall_clock_round_trips_naive(db: AsyncSession, test_user: UserRecord) -> None:
    trip = await _trip(db, test_user)
    day = Day(trip_id=trip.id, date=dt.date(2026, 5, 11), title="A")
    db.add(day)
    await db.commit()
    item = Item(day_id=day.id, position=0, title="x", start=dt.datetime(2026, 5, 11, 14, 0))
    db.add(item)
    await db.commit()
    db.expunge_all()

    loaded = await db.get(Item, item.id)
    assert loaded is not None
    assert loaded.start == dt.datetime(2026, 5, 11, 14, 0)
    assert loaded.start.tzinfo is None
