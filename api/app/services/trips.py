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

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import Role, active
from app.models import Day, Item, Stay, Travel, Trip, TripMember
from app.schemas import TripRead, TripSummary
from app.trip_document import DayWrite, ItemWrite, LocationDoc, StayDoc, TravelDoc, TripDocument
from app.zones import arrive_zone, depart_zone, item_zone, stay_zone


def _location(loc: LocationDoc | None) -> dict[str, Any] | None:
    # Stored under its wire (document) names, so it reads back through
    # LocationDoc as-is — `placeId`, not `place_id`.
    return loc.model_dump(by_alias=True, exclude_none=True) if loc is not None else None


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
            room_type=s.room_type,
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
            seat=t.seat,
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


def _summary(trip: Trip, *, stay_count: int, travel_count: int, role: str = "owner") -> TripSummary:
    return TripSummary(
        id=trip.id,
        name=trip.name,
        start_date=trip.start_date,
        end_date=trip.end_date,
        timezone=trip.timezone,
        stay_count=stay_count,
        travel_count=travel_count,
        created_at=trip.created_at,
        role=role,
    )


async def list_trips(db: AsyncSession, user_id: uuid.UUID) -> list[TripSummary]:
    """The user's live trips — owned and joined — soonest start first, with
    booking counts and the user's role on each."""
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
    member_role = (
        select(TripMember.role)
        .where(TripMember.trip_id == Trip.id, TripMember.user_id == user_id, active(TripMember))
        .correlate(Trip)
        .scalar_subquery()
    )
    result = await db.execute(
        select(Trip, stay_count, travel_count, member_role)
        .where(or_(Trip.user_id == user_id, member_role.is_not(None)), active(Trip))
        .order_by(Trip.start_date, Trip.created_at)
    )
    return [
        _summary(
            trip,
            stay_count=sc,
            travel_count=tc,
            role="owner" if trip.user_id == user_id else "editor" if role == "editor" else "viewer",
        )
        for trip, sc, tc, role in result.all()
    ]


async def trip_summary(db: AsyncSession, trip: Trip, role: Role) -> TripSummary:
    """One trip's summary (as in the list), for the given role."""
    stays = await db.scalar(
        select(func.count(Stay.id)).where(Stay.trip_id == trip.id, active(Stay))
    )
    travels = await db.scalar(
        select(func.count(Travel.id)).where(Travel.trip_id == trip.id, active(Travel))
    )
    return _summary(trip, stay_count=stays or 0, travel_count=travels or 0, role=role)


async def get_trip(db: AsyncSession, trip_id: uuid.UUID, role: Role = "owner") -> TripRead:
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
    trip = _with_zones(TripRead.model_validate(result.scalar_one()))
    # Edits only ever come from the owner, so "owner" is the default; reads
    # pass the caller's own role so the UI knows whether it may edit.
    trip.role = role
    return trip


def _with_zones(trip: TripRead) -> TripRead:
    """Fill in which clock every time is on (app/zones.py), for display."""
    tz = trip.timezone
    for stay in trip.stays:
        stay.zone = stay_zone(stay, tz)
    for travel in trip.travels:
        travel.depart_zone = depart_zone(travel, tz)
        travel.arrive_zone = arrive_zone(travel, tz)
    for day in trip.days:
        for item in day.items:
            item.zone = item_zone(item, day.date, trip.stays, tz)
    return trip


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


# ---- Editing stays and travel (bookings) ----
#
# Bookings are placed on the timeline by their times, so `position` is only
# insertion order. Full replace, like activities; every edit returns the trip.


def _apply_stay(stay: Stay, doc: StayDoc) -> None:
    stay.name = doc.name
    stay.type = doc.type
    stay.check_in = doc.check_in
    stay.check_out = doc.check_out
    stay.timezone = doc.timezone
    stay.location = _location(doc.location)
    stay.room_type = doc.room_type
    stay.confirmation_number = doc.confirmation_number
    stay.notes = doc.notes


def _apply_travel(travel: Travel, doc: TravelDoc) -> None:
    travel.title = doc.title
    travel.mode = doc.mode
    travel.carrier = doc.carrier
    travel.number = doc.number
    travel.seat = doc.seat
    travel.from_location = _location(doc.from_location)
    travel.to_location = _location(doc.to_location)
    travel.depart = doc.depart
    travel.arrive = doc.arrive
    travel.depart_timezone = doc.depart_timezone
    travel.arrive_timezone = doc.arrive_timezone
    travel.confirmation_number = doc.confirmation_number
    travel.notes = doc.notes


async def _next_booking_position(
    db: AsyncSession, model: type[Stay] | type[Travel], trip: Trip
) -> int:
    last = await db.scalar(
        select(func.max(model.position)).where(model.trip_id == trip.id, active(model))
    )
    return 0 if last is None else last + 1


async def create_stay(db: AsyncSession, trip: Trip, doc: StayDoc) -> TripRead:
    stay = Stay(trip_id=trip.id, position=await _next_booking_position(db, Stay, trip))
    _apply_stay(stay, doc)
    db.add(stay)
    await db.commit()
    return await get_trip(db, trip.id)


async def replace_stay(db: AsyncSession, trip: Trip, stay: Stay, doc: StayDoc) -> TripRead:
    _apply_stay(stay, doc)
    await db.commit()
    return await get_trip(db, trip.id)


async def delete_stay(db: AsyncSession, trip: Trip, stay: Stay) -> TripRead:
    stay.is_deleted = True
    stay.deleted_at = datetime.now(UTC)
    await db.commit()
    return await get_trip(db, trip.id)


async def create_travel(db: AsyncSession, trip: Trip, doc: TravelDoc) -> TripRead:
    travel = Travel(trip_id=trip.id, position=await _next_booking_position(db, Travel, trip))
    _apply_travel(travel, doc)
    db.add(travel)
    await db.commit()
    return await get_trip(db, trip.id)


async def replace_travel(db: AsyncSession, trip: Trip, travel: Travel, doc: TravelDoc) -> TripRead:
    _apply_travel(travel, doc)
    await db.commit()
    return await get_trip(db, trip.id)


async def delete_travel(db: AsyncSession, trip: Trip, travel: Travel) -> TripRead:
    travel.is_deleted = True
    travel.deleted_at = datetime.now(UTC)
    await db.commit()
    return await get_trip(db, trip.id)
