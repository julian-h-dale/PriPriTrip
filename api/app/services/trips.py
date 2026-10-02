"""Trip business logic — the single write path for trip content.

Every write to trips, stays, travels, days or items goes through this module
(lessons_learned.md §1): the importer today, editing later. Routers adapt HTTP
to these functions and contain no rules.
"""

from __future__ import annotations

import datetime as dt
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import active
from app.models import Day, Item, Stay, Travel, Trip
from app.schemas import TripRead, TripSummary
from app.trip_document import DayWrite, ItemWrite, LocationDoc, TripDocument


def _location(loc: LocationDoc | None) -> dict[str, Any] | None:
    return loc.model_dump(exclude_none=True) if loc is not None else None


async def import_trip(db: AsyncSession, user_id: uuid.UUID, doc: TripDocument) -> TripSummary:
    """Create a brand-new trip from a validated document, in one transaction.

    Import never updates or merges: the same document imported twice is two
    trips. Every row gets a fresh id; document order is kept in `position`.
    """
    trip = Trip(
        id=uuid.uuid4(),
        user_id=user_id,
        name=doc.name,
        start_date=doc.start_date,
        end_date=doc.end_date,
        timezone=doc.timezone,
    )
    db.add(trip)
    db.add_all(
        Stay(
            trip_id=trip.id,
            position=i,
            name=s.name,
            type=s.type,
            check_in=s.check_in,
            check_out=s.check_out,
            timezone=s.timezone,
            location=_location(s.location),
            confirmation_number=s.confirmation_number,
            notes=s.notes,
        )
        for i, s in enumerate(doc.stays)
    )
    db.add_all(
        Travel(
            trip_id=trip.id,
            position=i,
            title=t.title,
            mode=t.mode,
            carrier=t.carrier,
            number=t.number,
            from_location=_location(t.from_location),
            to_location=_location(t.to_location),
            depart=t.depart,
            arrive=t.arrive,
            depart_timezone=t.depart_timezone,
            arrive_timezone=t.arrive_timezone,
            confirmation_number=t.confirmation_number,
            notes=t.notes,
        )
        for i, t in enumerate(doc.travels)
    )
    for d in doc.days:
        day = Day(id=uuid.uuid4(), trip_id=trip.id, date=d.date, title=d.title, summary=d.summary)
        db.add(day)
        db.add_all(
            Item(
                day_id=day.id,
                position=j,
                title=it.title,
                start=it.start,
                end=it.end,
                timezone=it.timezone,
                location=_location(it.location),
                confirmation_number=it.confirmation_number,
                notes=it.notes,
            )
            for j, it in enumerate(d.items)
        )
    await db.commit()
    await db.refresh(trip)
    return _summary(trip, stay_count=len(doc.stays), travel_count=len(doc.travels))


def _summary(trip: Trip, *, stay_count: int, travel_count: int) -> TripSummary:
    return TripSummary(
        id=trip.id,
        name=trip.name,
        start_date=trip.start_date,
        end_date=trip.end_date,
        timezone=trip.timezone,
        stay_count=stay_count,
        travel_count=travel_count,
        created_at=trip.created_at,
    )


async def list_trips(db: AsyncSession, user_id: uuid.UUID) -> list[TripSummary]:
    """The user's live trips, soonest start first, with booking counts."""
    stay_count = (
        select(func.count(Stay.id))
        .where(Stay.trip_id == Trip.id, active(Stay))
        .correlate(Trip)
        .scalar_subquery()
    )
    travel_count = (
        select(func.count(Travel.id))
        .where(Travel.trip_id == Trip.id, active(Travel))
        .correlate(Trip)
        .scalar_subquery()
    )
    result = await db.execute(
        select(Trip, stay_count, travel_count)
        .where(Trip.user_id == user_id, active(Trip))
        .order_by(Trip.start_date, Trip.created_at)
    )
    return [_summary(trip, stay_count=sc, travel_count=tc) for trip, sc, tc in result.all()]


async def get_trip(db: AsyncSession, trip_id: uuid.UUID) -> TripRead:
    """The whole trip, assembled in a fixed number of queries.

    Relationships are lazy="raise", so everything the read model touches is
    loaded here explicitly, with the soft-delete filter on each level.
    """
    result = await db.execute(
        select(Trip)
        .where(Trip.id == trip_id)
        .options(
            selectinload(Trip.stays.and_(active(Stay))),
            selectinload(Trip.travels.and_(active(Travel))),
            selectinload(Trip.days.and_(active(Day))).selectinload(Day.items.and_(active(Item))),
        )
        .execution_options(populate_existing=True)
    )
    return TripRead.model_validate(result.scalar_one())


async def delete_trip(db: AsyncSession, trip: Trip) -> None:
    """Soft-delete the trip. Its children are only reachable through it."""
    trip.is_deleted = True
    trip.deleted_at = datetime.now(UTC)
    await db.commit()


# ---- Editing activities and days ----
#
# Every edit returns the whole updated trip, so the UI swaps it into state in
# one round trip and recomputes the timeline (markers included).


async def _day_for(db: AsyncSession, trip: Trip, day_date: dt.date) -> Day:
    """The trip's live day for a date, created (untitled) if the date has none."""
    day = await db.scalar(
        select(Day).where(Day.trip_id == trip.id, Day.date == day_date, active(Day))
    )
    if day is None:
        day = Day(id=uuid.uuid4(), trip_id=trip.id, date=day_date)
        db.add(day)
        await db.flush()
    return day


async def _next_position(db: AsyncSession, day: Day) -> int:
    last = await db.scalar(
        select(func.max(Item.position)).where(Item.day_id == day.id, active(Item))
    )
    return 0 if last is None else last + 1


def _apply_item(item: Item, write: ItemWrite) -> None:
    item.title = write.title
    item.start = write.start
    item.end = write.end
    item.timezone = write.timezone
    item.location = _location(write.location)
    item.confirmation_number = write.confirmation_number
    item.notes = write.notes


async def create_item(db: AsyncSession, trip: Trip, write: ItemWrite) -> TripRead:
    """Add an activity at the end of its date."""
    day = await _day_for(db, trip, write.date)
    item = Item(day_id=day.id, position=await _next_position(db, day), title=write.title)
    _apply_item(item, write)
    db.add(item)
    await db.commit()
    return await get_trip(db, trip.id)


async def replace_item(db: AsyncSession, trip: Trip, item: Item, write: ItemWrite) -> TripRead:
    """Full replace. A new date moves the activity to the end of that day."""
    current_day = await db.get(Day, item.day_id)
    if current_day is None or current_day.date != write.date:
        day = await _day_for(db, trip, write.date)
        item.day_id = day.id
        item.position = await _next_position(db, day)
    _apply_item(item, write)
    await db.commit()
    return await get_trip(db, trip.id)


async def delete_item(db: AsyncSession, trip: Trip, item: Item) -> TripRead:
    item.is_deleted = True
    item.deleted_at = datetime.now(UTC)
    await db.commit()
    return await get_trip(db, trip.id)


async def move_item(db: AsyncSession, trip: Trip, item: Item, direction: str) -> TripRead:
    """Swap an activity with its neighbour in the day. At either end it stays put."""
    siblings = list(
        (
            await db.scalars(
                select(Item).where(Item.day_id == item.day_id, active(Item)).order_by(Item.position)
            )
        ).all()
    )
    i = next(i for i, s in enumerate(siblings) if s.id == item.id)
    j = i - 1 if direction == "up" else i + 1
    if 0 <= j < len(siblings):
        siblings[i], siblings[j] = siblings[j], siblings[i]
        # Renumber the whole day: imports and moves can leave gaps or ties.
        for position, sibling in enumerate(siblings):
            sibling.position = position
        await db.commit()
    return await get_trip(db, trip.id)


async def update_day(db: AsyncSession, trip: Trip, day_date: dt.date, write: DayWrite) -> TripRead:
    """Set a date's title and summary, creating its day row if needed."""
    day = await _day_for(db, trip, day_date)
    day.title = write.title
    day.summary = write.summary
    await db.commit()
    return await get_trip(db, trip.id)
