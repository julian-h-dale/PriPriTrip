"""When is a trip *active*? (docs/active_trip_plan.md)

A trip becomes active on its start date and stops on the day after its end date.
That is a fact about the calendar, so it is **derived, never stored** — the moment
you persist "active" you have two sources of truth (the column and the clock) and
they will drift. Nothing here writes.

What the `status` column stores is *intent*:

    new     no content yet. Never active — there is nothing to be on.
    draft   has content. AUTOMATIC: active exactly while the trip is underway.
    active  a manual force-on, regardless of the dates.

The force-on is deliberate and the force-*off* is deliberately absent. Arriving a
day early is a real thing, so you can say so. But if the dates say you are
travelling, you are travelling — and the full itinerary is one tap away on the
What's Next screen, so there is nothing to escape from.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.enums import TripStatus
from app.models import TripRecord


def trip_timezone(trip: TripRecord) -> ZoneInfo:
    """Whose midnight starts the trip.

    The destination's, when we know it — a trip to Okinawa starts on Okinawa's
    Oct 30, not Chicago's. We fall back to UTC, which is currently every trip:
    `default_timezone_id` is null on all of them. The cost of that is a few hours
    of slop at the boundary, and the fix is to populate the column, not to make
    this cleverer.
    """
    tzid = (trip.default_timezone_id or "").strip()
    if tzid:
        try:
            return ZoneInfo(tzid)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return ZoneInfo("UTC")


def local_today(trip: TripRecord, now: datetime | None = None) -> date:
    """Today's date where the trip is happening."""
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(trip_timezone(trip)).date()


def is_underway(trip: TripRecord, now: datetime | None = None) -> bool:
    """Is the traveller on this trip right now, by the calendar?

    Inclusive at both ends: you are on the trip on its last day, not until the
    morning of it.
    """
    if trip.start_date is None or trip.end_date is None:
        return False
    today = local_today(trip, now)
    return trip.start_date <= today <= trip.end_date


def effective_status(trip: TripRecord, now: datetime | None = None) -> TripStatus:
    """What the API reports — the stored intent, resolved against the clock.

    This is what every serializer returns. The *stored* value is what the
    itinerary-re-import lock reads (`status != "new"`), and it is deliberately
    left alone: whether you happen to be mid-flight has nothing to do with
    whether a second itinerary may be imported over the top of this one.
    """
    stored = TripStatus(trip.status or TripStatus.NEW)

    if stored is TripStatus.NEW:
        return TripStatus.NEW  # nothing to be on yet
    if stored is TripStatus.ACTIVE:
        return TripStatus.ACTIVE  # forced on by hand

    return TripStatus.ACTIVE if is_underway(trip, now) else TripStatus.DRAFT
