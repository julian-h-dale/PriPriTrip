"""The one place trip content is written (review R4 / S1).

Every rule about what it *means* to create a stay, a travel leg, a point or a day
lives here, and here only. Two callers adapt to it:

    routers/*                  ─┐
    trip_action_executor.py    ─┤──►  trip_write  ──►  DB

The routers turn an HTTP body into a call; the executor turns an `AssistantAction`
into a call. **Neither of them contains a rule.**

Why this exists
---------------
These rules used to be implemented twice — once in the executor for the
assistant, once in the routers for the UI's own forms — and the two copies drifted.
Every drift was a real bug, and each arrived as a *correct fix applied to one door
and not the other*:

  * `promote_to_draft` was in the routers and not the executor, so a trip built by
    talking to the assistant stayed `status="new"` — and an itinerary import (a
    FULL REPLACE) would silently delete it.
  * `infer_tzid_from_locations` was in the routers and not the executor, so a stay
    the assistant resolved to a hotel in Naha was stamped `UTC` instead of
    `Asia/Tokyo` — a nine-hour error in the `startUtc` that the What's Next screen
    is built on.
  * Google Places resolution was in the executor and not the routers, so locations
    typed into the new-trip wizard never got coordinates.
  * `normalize_stay_wall_clock` (a date-only check-in means 4pm, not midnight) was
    in the routers and not the executor.

"Kept in sync by discipline" is not an architecture. So: one implementation, and
the two callers are adapters.

Conventions
-----------
* Functions take an already-loaded, already-authorized `TripRecord` and (for
  update/delete) the already-loaded child record. Ownership is the caller's job —
  it is an HTTP concern for one caller and a tool-result concern for the other.
* Input is a Pydantic model. `update_*` respects `model_fields_set`, so an
  explicit `null` **clears** the column and an absent key leaves it alone. That
  distinction is the whole reason the assistant can now unset a value.
* Nothing here commits. The caller owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import DERIVED_POINT_TYPES
from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
)
from app.services.detail_points import (
    CHECK_IN_DEFAULT_TIME,
    CHECK_OUT_DEFAULT_TIME,
    generated_point_conflict,
    normalize_stay_wall_clock,
    primary_day_for_date,
    reconcile_trip_days,
    soft_delete_generated_points_for_stay,
    soft_delete_generated_points_for_travel,
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services.llm_contract import LocationDecision
from app.services.location_resolver import enrich_location_dict
from app.services.locations import location_rows
from app.services.timezones import (
    derive_utc,
    infer_tzid_from_locations,
    parse_wall_clock,
    wall_clock_to_text,
)
from app.services.trip_state import promote_to_draft


class WriteError(ValueError):
    """A write we refuse.

    The message is the whole payload: the routers turn it into an HTTP detail and
    the executor hands it to the model as a tool result. So it must say what to do
    *instead* — the model reads it and retries, and a person reads it in a toast.

    `status_code` is carried here rather than chosen by each router, so the same
    refusal always gets the same HTTP status wherever it surfaces.
    """

    status_code = 422


class ConflictError(WriteError):
    """A write that collides with something that already exists."""

    status_code = 409


@dataclass
class WriteResult:
    record: Any
    # What Google Places decided about each location we resolved. `medium` means
    # it was ambiguous and deliberately NOT applied — the chat turns these into a
    # choice card; the REST callers simply ignore them.
    location_decisions: list[LocationDecision] = field(default_factory=list)


def new_id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


def _as_location_dicts(locations: Iterable[Any] | None) -> list[dict[str, Any]]:
    """Locations arrive as Pydantic models (routers) or plain dicts (executor)."""
    out: list[dict[str, Any]] = []
    for loc in locations or []:
        if isinstance(loc, dict):
            out.append(dict(loc))
        elif hasattr(loc, "model_dump"):
            out.append(loc.model_dump(by_alias=True))
        else:  # an ORM row, when we re-read a record's existing locations
            out.append(
                {
                    "locationId": loc.location_id,
                    "role": loc.role,
                    "name": loc.name,
                    "lat": loc.lat,
                    "lng": loc.lng,
                    "fullAddress": loc.full_address,
                    "description": loc.description,
                    "link": loc.link,
                    "googlePlaceId": loc.google_place_id,
                    "googleMapsUri": loc.google_maps_uri,
                    "timezoneId": loc.timezone_id,
                }
            )
    return out


async def resolve_locations(
    locations: Iterable[Any] | None,
    *,
    near: str | None,
) -> tuple[list[dict[str, Any]], list[LocationDecision]]:
    """Give every location its authoritative place data.

    Runs for *both* callers now. It is nearly free for a location the UI already
    resolved through the Places autocomplete — `enrich_location_dict` short-circuits
    on one that already has a place id and coordinates — and it is the only way a
    bare name ("ORD", typed into the new-trip wizard) ever gets coordinates.

    A `medium` decision means the place was ambiguous and was deliberately NOT
    applied: the chat offers the user a choice rather than silently taking
    candidate #1.
    """
    prepared: list[dict[str, Any]] = []
    decisions: list[LocationDecision] = []

    for raw in _as_location_dicts(locations):
        loc = dict(raw)
        loc["locationId"] = loc.get("locationId") or new_id()
        loc, resolution = await enrich_location_dict(loc, near=near)
        prepared.append(loc)
        if resolution is not None:
            decisions.append(
                LocationDecision(
                    location_id=loc["locationId"],
                    query=resolution.query,
                    confidence=resolution.confidence,
                    resolved_name=(resolution.chosen or {}).get("name"),
                    candidates=[
                        {
                            "googlePlaceId": c.get("googlePlaceId"),
                            "name": c.get("name"),
                            "fullAddress": c.get("fullAddress"),
                            "googleMapsUri": c.get("googleMapsUri"),
                        }
                        for c in resolution.candidates
                    ]
                    if resolution.is_ambiguous
                    else [],
                )
            )
    return prepared, decisions


async def _existing_locations(
    db: AsyncSession,
    *,
    point_id: str | None = None,
    stay_id: str | None = None,
    travel_id: str | None = None,
) -> list[LocationRecord]:
    if point_id is not None:
        cond = LocationRecord.point_id == point_id
    elif stay_id is not None:
        cond = LocationRecord.stay_detail_id == stay_id
    else:
        cond = LocationRecord.travel_detail_id == travel_id
    from sqlalchemy import select

    result = await db.execute(select(LocationRecord).where(cond).order_by(LocationRecord.sort_order))
    return list(result.scalars().all())


async def _write_locations(
    db: AsyncSession,
    prepared: list[dict[str, Any]],
    *,
    point_id: str | None = None,
    stay_id: str | None = None,
    travel_id: str | None = None,
) -> None:
    if point_id is not None:
        await db.execute(delete(LocationRecord).where(LocationRecord.point_id == point_id))
    elif stay_id is not None:
        await db.execute(delete(LocationRecord).where(LocationRecord.stay_detail_id == stay_id))
    else:
        await db.execute(delete(LocationRecord).where(LocationRecord.travel_detail_id == travel_id))

    for row in location_rows(
        prepared, point_id=point_id, stay_detail_id=stay_id, travel_detail_id=travel_id
    ):
        db.add(row)



def _set_from_patch(rec: Any, patch: Any, fields: tuple[str, ...]) -> None:
    """Apply only the fields the caller actually sent.

    `model_fields_set` is what makes an explicit `null` mean *clear this column*
    while an absent key means *leave it alone*. Both callers depend on it: it is
    how a person empties a field in a form, and how the assistant honours
    "remove that confirmation number, it's wrong".
    """
    for name in fields:
        if name in patch.model_fields_set:
            setattr(rec, name, getattr(patch, name))


# ══════════════════════════════════════════════════════════════════════════════
# Stays
# ══════════════════════════════════════════════════════════════════════════════

_STAY_SCALARS = ("name", "stay_type", "room_type", "confirmation_number", "description")


def _stay_times(
    rec: StayDetailRecord,
    *,
    check_in: str | None,
    check_out: str | None,
    check_in_tzid: str | None,
    check_out_tzid: str | None,
) -> None:
    # A date with no time means 4pm, not midnight — that is what "check in on the
    # 30th" means to a traveller.
    check_in = normalize_stay_wall_clock(check_in, default_time=CHECK_IN_DEFAULT_TIME)
    check_out = normalize_stay_wall_clock(check_out, default_time=CHECK_OUT_DEFAULT_TIME)

    rec.check_in_local = parse_wall_clock(check_in)
    rec.check_in_tzid = check_in_tzid
    rec.check_in_utc = derive_utc(rec.check_in_local, check_in_tzid)

    rec.check_out_local = parse_wall_clock(check_out)
    rec.check_out_tzid = check_out_tzid
    rec.check_out_utc = derive_utc(rec.check_out_local, check_out_tzid)


async def create_stay(db: AsyncSession, trip: TripRecord, data) -> WriteResult:
    stay_id = data.stay_detail_id or new_id()

    prepared, decisions = await resolve_locations(
        data.locations, near=trip.destination_location_name
    )

    # The timezone comes from the *place*, not from the trip. A hotel in Naha is on
    # Tokyo time even when the trip has no default timezone set (which is every
    # trip). Resolving the locations first is what makes this possible: they now
    # carry coordinates.
    check_in_tzid = data.check_in_timezone_id or infer_tzid_from_locations(
        prepared, role="venue", fallback=trip.default_timezone_id
    )
    check_out_tzid = data.check_out_timezone_id or check_in_tzid

    rec = StayDetailRecord(
        stay_detail_id=stay_id,
        trip_id=trip.trip_id,
        name=data.name,
        stay_type=data.stay_type,
        room_type=data.room_type,
        confirmation_number=data.confirmation_number,
        description=data.description,
    )
    _stay_times(
        rec,
        check_in=data.check_in,
        check_out=data.check_out,
        check_in_tzid=check_in_tzid,
        check_out_tzid=check_out_tzid,
    )
    db.add(rec)
    await db.flush()

    await _write_locations(db, prepared, stay_id=stay_id)
    await sync_stay_generated_points(db, stay=rec)
    promote_to_draft(trip)
    await db.flush()
    return WriteResult(record=rec, location_decisions=decisions)


async def update_stay(
    db: AsyncSession, trip: TripRecord, rec: StayDetailRecord, patch
) -> WriteResult:
    _set_from_patch(rec, patch, _STAY_SCALARS)

    decisions: list[LocationDecision] = []
    if "locations" in patch.model_fields_set:
        prepared, decisions = await resolve_locations(
            patch.locations, near=trip.destination_location_name
        )
        await _write_locations(db, prepared, stay_id=rec.stay_detail_id)
        locations_for_tz: list[Any] = prepared
    else:
        locations_for_tz = await _existing_locations(db, stay_id=rec.stay_detail_id)

    check_in = (
        patch.check_in
        if "check_in" in patch.model_fields_set
        else wall_clock_to_text(rec.check_in_local)
    )
    check_out = (
        patch.check_out
        if "check_out" in patch.model_fields_set
        else wall_clock_to_text(rec.check_out_local)
    )

    check_in_tzid = (
        patch.check_in_timezone_id
        if "check_in_timezone_id" in patch.model_fields_set
        else rec.check_in_tzid
    ) or infer_tzid_from_locations(
        locations_for_tz, role="venue", fallback=trip.default_timezone_id
    )
    check_out_tzid = (
        patch.check_out_timezone_id
        if "check_out_timezone_id" in patch.model_fields_set
        else rec.check_out_tzid
    ) or check_in_tzid

    _stay_times(
        rec,
        check_in=check_in,
        check_out=check_out,
        check_in_tzid=check_in_tzid,
        check_out_tzid=check_out_tzid,
    )

    await sync_stay_generated_points(db, stay=rec)
    await db.flush()
    return WriteResult(record=rec, location_decisions=decisions)


async def delete_stay(db: AsyncSession, trip: TripRecord, rec: StayDetailRecord) -> None:
    rec.is_deleted = True
    rec.deleted_at = _now()
    await soft_delete_generated_points_for_stay(db, stay_detail_id=rec.stay_detail_id)
    await db.flush()


# ══════════════════════════════════════════════════════════════════════════════
# Travel legs
# ══════════════════════════════════════════════════════════════════════════════

_TRAVEL_SCALARS = (
    "name",
    "mode",
    "operator",
    "vehicle_number",
    "cabin_class",
    "confirmation_number",
    "description",
)


def _travel_times(
    rec: TravelDetailRecord,
    *,
    departure: str | None,
    arrival: str | None,
    departure_tzid: str | None,
    arrival_tzid: str | None,
) -> None:
    rec.departure_local = parse_wall_clock(departure)
    rec.departure_tzid = departure_tzid
    rec.departure_utc = derive_utc(rec.departure_local, departure_tzid)

    rec.arrival_local = parse_wall_clock(arrival)
    rec.arrival_tzid = arrival_tzid
    rec.arrival_utc = derive_utc(rec.arrival_local, arrival_tzid)


async def create_travel(db: AsyncSession, trip: TripRecord, data) -> WriteResult:
    travel_id = data.travel_detail_id or new_id()

    prepared, decisions = await resolve_locations(
        data.locations, near=trip.destination_location_name
    )

    # Each end of the journey is on its own clock: you leave on Chicago time and
    # land on Tokyo time.
    departure_tzid = data.departure_timezone_id or infer_tzid_from_locations(
        prepared, role="origin", fallback=trip.default_timezone_id
    )
    arrival_tzid = data.arrival_timezone_id or infer_tzid_from_locations(
        prepared, role="destination", fallback=trip.default_timezone_id
    )

    rec = TravelDetailRecord(
        travel_detail_id=travel_id,
        trip_id=trip.trip_id,
        name=data.name,
        mode=data.mode,
        operator=data.operator,
        vehicle_number=data.vehicle_number,
        cabin_class=data.cabin_class,
        confirmation_number=data.confirmation_number,
        description=data.description,
    )
    _travel_times(
        rec,
        departure=data.departure_date_time,
        arrival=data.arrival_date_time,
        departure_tzid=departure_tzid,
        arrival_tzid=arrival_tzid,
    )
    db.add(rec)
    await db.flush()

    await _write_locations(db, prepared, travel_id=travel_id)
    await sync_travel_generated_points(db, travel=rec)
    promote_to_draft(trip)
    await db.flush()
    return WriteResult(record=rec, location_decisions=decisions)


async def update_travel(
    db: AsyncSession, trip: TripRecord, rec: TravelDetailRecord, patch
) -> WriteResult:
    _set_from_patch(rec, patch, _TRAVEL_SCALARS)

    decisions: list[LocationDecision] = []
    if "locations" in patch.model_fields_set:
        prepared, decisions = await resolve_locations(
            patch.locations, near=trip.destination_location_name
        )
        await _write_locations(db, prepared, travel_id=rec.travel_detail_id)
        locations_for_tz: list[Any] = prepared
    else:
        locations_for_tz = await _existing_locations(db, travel_id=rec.travel_detail_id)

    departure = (
        patch.departure_date_time
        if "departure_date_time" in patch.model_fields_set
        else wall_clock_to_text(rec.departure_local)
    )
    arrival = (
        patch.arrival_date_time
        if "arrival_date_time" in patch.model_fields_set
        else wall_clock_to_text(rec.arrival_local)
    )

    departure_tzid = (
        patch.departure_timezone_id
        if "departure_timezone_id" in patch.model_fields_set
        else rec.departure_tzid
    ) or infer_tzid_from_locations(
        locations_for_tz, role="origin", fallback=trip.default_timezone_id
    )
    arrival_tzid = (
        patch.arrival_timezone_id
        if "arrival_timezone_id" in patch.model_fields_set
        else rec.arrival_tzid
    ) or infer_tzid_from_locations(
        locations_for_tz, role="destination", fallback=trip.default_timezone_id
    )

    _travel_times(
        rec,
        departure=departure,
        arrival=arrival,
        departure_tzid=departure_tzid,
        arrival_tzid=arrival_tzid,
    )

    await sync_travel_generated_points(db, travel=rec)
    await db.flush()
    return WriteResult(record=rec, location_decisions=decisions)


async def delete_travel(db: AsyncSession, trip: TripRecord, rec: TravelDetailRecord) -> None:
    rec.is_deleted = True
    rec.deleted_at = _now()
    await soft_delete_generated_points_for_travel(db, travel_detail_id=rec.travel_detail_id)
    await db.flush()


# ══════════════════════════════════════════════════════════════════════════════
# Points
# ══════════════════════════════════════════════════════════════════════════════

_POINT_SCALARS = (
    "day_id",
    "type",
    "title",
    "stay_detail_id",
    "travel_detail_id",
    "confirmation_number",
    "description",
    "image_url",
    "logo_url",
    "completed",
    "completed_date_time",
)

DERIVED_POINT_REFUSAL = (
    "A {type!r} point is generated from the stay or travel leg it belongs to, so it "
    "cannot be created or edited directly. Create the stay (with checkIn/checkOut) or "
    "the travel leg (with departureDateTime/arrivalDateTime) instead, and the point "
    "appears on the timeline by itself. Only 'activity' points are authored directly."
)


def reject_derived_type(point_type: Any) -> None:
    """Only `activity` points are authored; the rest are generated (DERIVED_POINT_TYPES)."""
    if point_type in DERIVED_POINT_TYPES:
        raise WriteError(DERIVED_POINT_REFUSAL.format(type=point_type))



async def _stay_tzid_for_day(db: AsyncSession, *, trip: TripRecord, day_id: str) -> str | None:
    """The timezone of whichever stay covers this day.

    A dinner reservation carries no coordinates of its own, but you are sleeping
    somewhere that night — and that hotel knows what time zone it is in. This was
    only in the points router; the assistant's points had to make do with the
    trip default (i.e. UTC).
    """
    day = await db.get(TripDayRecord, day_id)
    if day is None:
        return None

    from sqlalchemy import select

    from app.models import active as _active

    stays = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip.trip_id, _active(StayDetailRecord)
        )
    )
    for stay in stays.scalars().all():
        if stay.check_in_local is None or stay.check_out_local is None:
            continue
        if stay.check_in_local.date() <= day.date <= stay.check_out_local.date():
            locs = await _existing_locations(db, stay_id=stay.stay_detail_id)
            tzid = infer_tzid_from_locations(locs, fallback=None)
            if tzid:
                return tzid
            if stay.check_in_tzid:
                return stay.check_in_tzid
    return None


async def _point_tzid(
    db: AsyncSession,
    *,
    trip: TripRecord,
    day_id: str,
    locations,
    explicit: str | None,
) -> str:
    """Where a point happens, in order of how much we trust it."""
    if explicit:
        return explicit
    return (
        infer_tzid_from_locations(locations, fallback=None)
        or await _stay_tzid_for_day(db, trip=trip, day_id=day_id)
        or trip.default_timezone_id
        or "UTC"
    )


def _point_times(
    rec: TripPointRecord,
    *,
    start: str | None,
    end: str | None,
    start_tzid: str | None,
    end_tzid: str | None,
) -> None:
    rec.start_local = parse_wall_clock(start)
    rec.start_tzid = start_tzid
    rec.start_utc = derive_utc(rec.start_local, start_tzid)

    rec.end_local = parse_wall_clock(end)
    rec.end_tzid = end_tzid
    rec.end_utc = derive_utc(rec.end_local, end_tzid)


async def create_point(db: AsyncSession, trip: TripRecord, day: TripDayRecord, data) -> WriteResult:
    reject_derived_type(data.type)

    point_id = data.point_id or new_id()
    prepared, decisions = await resolve_locations(
        data.locations, near=trip.destination_location_name
    )

    inferred = await _point_tzid(
        db,
        trip=trip,
        day_id=day.day_id,
        locations=prepared,
        explicit=data.start_timezone_id or data.end_timezone_id,
    )
    start_tzid = data.start_timezone_id or inferred
    end_tzid = data.end_timezone_id or inferred

    rec = TripPointRecord(
        point_id=point_id,
        trip_id=trip.trip_id,
        day_id=day.day_id,
        type=data.type,
        title=data.title,
        stay_detail_id=data.stay_detail_id,
        travel_detail_id=data.travel_detail_id,
        confirmation_number=data.confirmation_number,
        description=data.description,
        image_url=data.image_url,
        logo_url=data.logo_url,
        is_system_created=False,  # a generated point is detail_points.py's to make
        completed=bool(getattr(data, "completed", False)),
        completed_date_time=getattr(data, "completed_date_time", None),
    )
    _point_times(
        rec,
        start=data.start_date_time,
        end=data.end_date_time,
        start_tzid=start_tzid,
        end_tzid=end_tzid,
    )
    db.add(rec)
    await db.flush()

    await _write_locations(db, prepared, point_id=point_id)
    promote_to_draft(trip)
    await db.flush()
    return WriteResult(record=rec, location_decisions=decisions)


async def update_point(
    db: AsyncSession, trip: TripRecord, rec: TripPointRecord, patch
) -> WriteResult:
    if "type" in patch.model_fields_set:
        reject_derived_type(patch.type)

    # A generated point is rebuilt from its parent on every sync, so a structural
    # edit here would be silently undone. `completed` is the exception — ticking
    # off a check-in is the traveller's business, not the stay's.
    conflict = generated_point_conflict(rec, patch.model_fields_set)
    if conflict:
        raise ConflictError(conflict)

    _set_from_patch(rec, patch, _POINT_SCALARS)

    decisions: list[LocationDecision] = []
    if "locations" in patch.model_fields_set:
        prepared, decisions = await resolve_locations(
            patch.locations, near=trip.destination_location_name
        )
        await _write_locations(db, prepared, point_id=rec.point_id)
        locations_for_tz: list[Any] = prepared
    else:
        locations_for_tz = await _existing_locations(db, point_id=rec.point_id)

    start = (
        patch.start_date_time
        if "start_date_time" in patch.model_fields_set
        else wall_clock_to_text(rec.start_local)
    )
    end = (
        patch.end_date_time
        if "end_date_time" in patch.model_fields_set
        else wall_clock_to_text(rec.end_local)
    )

    explicit_start = (
        patch.start_timezone_id
        if "start_timezone_id" in patch.model_fields_set
        else rec.start_tzid
    )
    explicit_end = (
        patch.end_timezone_id if "end_timezone_id" in patch.model_fields_set else rec.end_tzid
    )
    inferred = await _point_tzid(
        db,
        trip=trip,
        day_id=rec.day_id,
        locations=locations_for_tz,
        explicit=explicit_start or explicit_end,
    )
    start_tzid = explicit_start or inferred
    end_tzid = explicit_end or inferred

    _point_times(rec, start=start, end=end, start_tzid=start_tzid, end_tzid=end_tzid)
    await db.flush()
    return WriteResult(record=rec, location_decisions=decisions)


async def delete_point(db: AsyncSession, trip: TripRecord, rec: TripPointRecord) -> None:
    if rec.is_system_created:
        parent = "stay" if rec.stay_detail_id else "travel leg"
        parent_id = rec.stay_detail_id or rec.travel_detail_id
        raise ConflictError(
            f"{rec.title!r} is generated from its {parent} and would come straight back "
            f"on the next sync. To remove it, delete the {parent} ({parent_id}) or clear "
            f"the time it is generated from."
        )
    rec.is_deleted = True
    rec.deleted_at = _now()
    await db.flush()


# ══════════════════════════════════════════════════════════════════════════════
# Days
# ══════════════════════════════════════════════════════════════════════════════


@dataclass
class DayWriteResult(WriteResult):
    # True when "create" landed on a date that already had a day and renamed it
    # instead of adding a second one. The caller tells whoever asked, so they use
    # the right id for the points they add next.
    adopted: bool = False


async def create_day(
    db: AsyncSession, trip: TripRecord, data, *, adopt_existing: bool = False
) -> DayWriteResult:
    """Name a date.

    The **rule** is shared: a date has at most one primary day. Every date in the
    trip's range already has one, and saving a flight makes one for any date outside
    it — so a second day for the same date must never appear on the timeline.
    (An alternate is exempt: a second, competing plan for a date is what they are for.)

    How the collision is *surfaced* is legitimately per-caller, and that is the only
    thing `adopt_existing` selects:

    * The **assistant** (`adopt_existing=True`) means "name this date" when it says
      create. Renaming the day that is there and handing back its id lets it recover
      inside the turn and put its points on the right day.
    * A **REST client** (`adopt_existing=False`) asked to POST a new row onto a date
      that already has one. That is a 409 — it should not have asked.
    """
    is_alternate = bool(getattr(data, "is_alternate", False))

    if not is_alternate:
        existing = await primary_day_for_date(db, trip_id=trip.trip_id, day_date=data.date)
        if existing is not None:
            if not adopt_existing:
                raise ConflictError(
                    f"{data.date.isoformat()} already has a day ({existing.title!r}). Edit that "
                    f"one, or mark this an alternate if you mean a second plan for the same date."
                )
            existing.title = data.title
            if getattr(data, "description", None) is not None:
                existing.description = data.description
            await db.flush()
            return DayWriteResult(record=existing, adopted=True)

    rec = TripDayRecord(
        day_id=getattr(data, "day_id", None) or new_id(),
        trip_id=trip.trip_id,
        title=data.title,
        date=data.date,
        description=getattr(data, "description", None),
        is_alternate=is_alternate,
        completed=bool(getattr(data, "completed", False)),
    )
    db.add(rec)
    await db.flush()
    return DayWriteResult(record=rec, adopted=False)


async def update_day(db: AsyncSession, trip: TripRecord, rec: TripDayRecord, patch) -> WriteResult:
    if "date" in patch.model_fields_set and patch.date and patch.date != rec.date:
        is_alternate = (
            patch.is_alternate if "is_alternate" in patch.model_fields_set else rec.is_alternate
        )
        if not is_alternate:
            clash = await primary_day_for_date(db, trip_id=trip.trip_id, day_date=patch.date)
            if clash is not None and clash.day_id != rec.day_id:
                raise ConflictError(
                    f"{patch.date.isoformat()} already has a day ({clash.day_id}, "
                    f"{clash.title!r}). Edit that one, or move its points across, rather "
                    f"than moving a second day onto the same date."
                )

    _set_from_patch(rec, patch, ("title", "date", "description", "is_alternate", "completed"))
    await db.flush()
    return WriteResult(record=rec)


async def delete_day(db: AsyncSession, trip: TripRecord, rec: TripDayRecord) -> None:
    rec.is_deleted = True
    rec.deleted_at = _now()
    await db.flush()


# ══════════════════════════════════════════════════════════════════════════════
# The trip itself
# ══════════════════════════════════════════════════════════════════════════════

_TRIP_SCALARS = (
    "trip_name",
    "start_location_name",
    "destination_location_name",
    "default_timezone_id",
    "start_date",
    "end_date",
)


async def update_trip(db: AsyncSession, trip: TripRecord, patch) -> WriteResult:
    """Update the trip header, keeping its day rows aligned with its dates.

    A trip's dates and its day rows are the same fact. Change one without the other
    and the trip has a range with an empty timeline, and the next flight to land on
    one of those dates quietly invents the day it needed.
    """
    dates_changed = bool({"start_date", "end_date"} & patch.model_fields_set)

    _set_from_patch(trip, patch, _TRIP_SCALARS)
    await db.flush()

    if dates_changed:
        await reconcile_trip_days(db, trip)
    await db.flush()
    return WriteResult(record=trip)
