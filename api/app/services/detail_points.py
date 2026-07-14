from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import LocationRole
from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    active,
)
from app.services.timezones import derive_utc, parse_wall_clock, wall_clock_to_text

CHECK_IN_DEFAULT_TIME = "16:00"
CHECK_OUT_DEFAULT_TIME = "11:00"


# Everything a generated point shows is copied from its parent on every sync, so
# writing to any of it here would be silently reverted. These two are the
# exception: ticking off a check-in is the user's business, not the stay's, and
# the sync leaves them alone.
USER_OWNED_POINT_FIELDS = frozenset({"completed", "completed_date_time"})


def generated_point_conflict(
    point: TripPointRecord,
    changed_fields: Iterable[str],
) -> str | None:
    """Why this write to a generated point can't stand — or None if it can.

    Names the parent to edit instead, so both a person and the model can recover
    without guessing.
    """
    if not point.is_system_created:
        return None
    blocked = sorted(set(changed_fields) - USER_OWNED_POINT_FIELDS)
    if not blocked:
        return None

    parent = "stay" if point.stay_detail_id else "travel leg"
    parent_id = point.stay_detail_id or point.travel_detail_id
    return (
        f"{', '.join(blocked)} cannot be set on {point.title!r}: it is generated from its "
        f"{parent} and is rebuilt whenever that {parent} changes, so the edit would be "
        f"undone. Update the {parent} ({parent_id}) instead — its times, confirmation "
        f"number and locations are what this point shows."
    )


def normalize_stay_wall_clock(value: str | None, *, default_time: str) -> str | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if "T" not in text:
        return f"{text}T{default_time}"
    return text


async def primary_day_for_date(
    db: AsyncSession,
    *,
    trip_id: str,
    day_date: date,
) -> TripDayRecord | None:
    """The trip's one real day for this date, if it has one.

    A date may also carry *alternate* days — a different plan for the same
    date, which the UI chips and verification ignores — and there can be several
    of those. Exactly one day per date is the primary one, and this is it.
    Every writer goes through here, because two of them independently creating
    a day for the same date is what put July 25th on the timeline twice.
    """
    result = await db.execute(
        select(TripDayRecord)
        .where(
            TripDayRecord.trip_id == trip_id,
            TripDayRecord.date == day_date,
            TripDayRecord.is_alternate.is_(False),
            active(TripDayRecord),
        )
        .order_by(TripDayRecord.created_at)
    )
    return result.scalars().first()


async def _get_or_create_day_for_date(db: AsyncSession, *, trip_id: str, day_date: date) -> TripDayRecord:
    existing = await primary_day_for_date(db, trip_id=trip_id, day_date=day_date)
    if existing is not None:
        return existing

    created = TripDayRecord(
        day_id=str(uuid.uuid4()),
        trip_id=trip_id,
        # A placeholder title. Whoever names the day properly later — the model,
        # the importer — adopts this row rather than adding a second one.
        title=day_date.isoformat(),
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
    conditions: list[ColumnElement[bool]] = [
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
    point.deleted_at = datetime.now(UTC)


async def _parent_locations(
    db: AsyncSession,
    *,
    stay_detail_id: str | None = None,
    travel_detail_id: str | None = None,
) -> list[LocationRecord]:
    if stay_detail_id is not None:
        condition = LocationRecord.stay_detail_id == stay_detail_id
    else:
        condition = LocationRecord.travel_detail_id == travel_detail_id
    result = await db.execute(
        select(LocationRecord).where(condition).order_by(LocationRecord.sort_order)
    )
    return list(result.scalars().all())


_MIRRORED_LOCATION_FIELDS = (
    "name",
    "lat",
    "lng",
    "full_address",
    "description",
    "link",
    "google_place_id",
    "google_maps_uri",
    "timezone_id",
)


async def _mirror_locations(
    db: AsyncSession,
    *,
    point: TripPointRecord,
    sources: list[LocationRecord],
) -> None:
    """Give a generated point the place it happens at.

    A generated point is a projection of its parent, and it was already copying
    the parent's title, times and confirmation number — but not its locations,
    so every check-in and departure point on the timeline had no place attached
    and rendered blank.

    Locations are single-owner (see the check constraint on LocationRecord), so
    the point cannot point at the parent's row; it needs its own copy. The copy
    is rebuilt from the parent on every sync, which is what keeps it honest —
    edit the flight's origin airport and the departure point follows.
    """
    existing = await db.execute(
        select(LocationRecord).where(LocationRecord.point_id == point.point_id)
    )
    for stale in existing.scalars().all():
        await db.delete(stale)

    for order, source in enumerate(sources):
        mirrored = LocationRecord(
            location_id=str(uuid.uuid4()),
            point_id=point.point_id,
            role=source.role,
            sort_order=order,
            **{field: getattr(source, field) for field in _MIRRORED_LOCATION_FIELDS},
        )
        db.add(mirrored)


def _with_role(locations: list[LocationRecord], role: str) -> list[LocationRecord]:
    """The parent's locations that belong on this end of the journey.

    A departure happens at the origin and an arrival at the destination — so
    they take one end each, and a waypoint belongs to neither.
    """
    return [loc for loc in locations if loc.role == role]


def _stay_venue(locations: list[LocationRecord]) -> list[LocationRecord]:
    """Where the stay is. Both check-in and check-out happen there.

    Prefer the location tagged `venue`; a stay imported from a document
    sometimes has only an untagged one, so fall back to the first.
    """
    venue = _with_role(locations, LocationRole.VENUE)
    if venue:
        return venue[:1]
    return locations[:1]


async def sync_travel_generated_points(
    db: AsyncSession,
    *,
    travel: TravelDetailRecord,
) -> None:
    existing = await _load_generated_points(db, travel_detail_id=travel.travel_detail_id)
    parent_locations = await _parent_locations(db, travel_detail_id=travel.travel_detail_id)
    events = [
        (
            "departure",
            wall_clock_to_text(travel.departure_local),
            travel.departure_tzid,
            _with_role(parent_locations, LocationRole.ORIGIN),
        ),
        (
            "arrival",
            wall_clock_to_text(travel.arrival_local),
            travel.arrival_tzid,
            _with_role(parent_locations, LocationRole.DESTINATION),
        ),
    ]

    for point_type, time_text, tzid, point_locations in events:
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
        await db.flush()  # a new point needs its id before a location can hang off it
        await _mirror_locations(db, point=point, sources=point_locations)


async def sync_stay_generated_points(
    db: AsyncSession,
    *,
    stay: StayDetailRecord,
) -> None:
    existing = await _load_generated_points(db, stay_detail_id=stay.stay_detail_id)
    # Both ends of a stay happen at the same place.
    venue = _stay_venue(await _parent_locations(db, stay_detail_id=stay.stay_detail_id))
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
        await db.flush()  # a new point needs its id before a location can hang off it
        await _mirror_locations(db, point=point, sources=venue)


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
    # Only a primary day counts as "this date is covered". An alternate is a
    # second plan for a date, not the date itself — a range holding nothing but
    # an alternate still needs its real day.
    covered_dates = {day.date for day in existing_days if not day.is_alternate}

    current = start
    desired_dates: set[date] = set()
    while current <= end:
        desired_dates.add(current)
        if current not in covered_dates:
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
            covered_dates.add(current)
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
            day.deleted_at = datetime.now(UTC)

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
