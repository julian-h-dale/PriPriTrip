"""Which clock a trip time is on — the one rule, used everywhere.

Users only ever enter wall-clock times ("the ticket says 14:30"); the zone is
inferred from *where* the time happens. The zone for a time comes from:

1. its place's coordinates (offline lookup via tzfpy), when it has them;
2. otherwise an explicit timezone written in the document (an import-only
   escape hatch — the UI never asks for one);
3. for an activity only, otherwise the stay that covers that night (or the
   stay checking out that morning);
4. otherwise the trip's timezone.

Validation (import and every edit) and the read model both call these
functions, so the clock used to check a time and the clock shown for it can't
disagree. Zones are computed, never stored: an activity's fallback depends on
another row (its night's stay), so a stored copy would go stale the moment the
stay changed (lessons_learned.md §2). Lookups take microseconds.

Duck-typed on purpose (anything with the document's attribute names), so this
module has no import cycle with app/trip_document.py.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from tzfpy import get_tz


class _Place(Protocol):
    lat: float | None
    lng: float | None


def zone_at(lat: float, lng: float) -> str | None:
    """The IANA zone at a coordinate, or None if it can't be resolved."""
    name = get_tz(lng, lat)  # tzfpy takes (lng, lat)
    if not name:
        return None
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None
    return name


def place_zone(place: _Place | None) -> str | None:
    if place is None or place.lat is None or place.lng is None:
        return None
    return zone_at(place.lat, place.lng)


def stay_zone(stay: Any, trip_zone: str) -> str:
    """Check-in and check-out are on the clock of where you stay."""
    return place_zone(stay.location) or stay.timezone or trip_zone


def depart_zone(travel: Any, trip_zone: str) -> str:
    """Departure is on the clock of where the leg leaves from."""
    return place_zone(travel.from_location) or travel.depart_timezone or trip_zone


def arrive_zone(travel: Any, trip_zone: str) -> str:
    """Arrival is on the clock of where the leg lands."""
    return place_zone(travel.to_location) or travel.arrive_timezone or trip_zone


def night_stay(stays: Iterable[Any], day: dt.date) -> Any | None:
    """The stay you sleep in on `day`'s night, else the one you leave that morning."""
    stays = list(stays)
    for stay in stays:
        if stay.check_in.date() <= day < stay.check_out.date():
            return stay
    for stay in stays:
        if stay.check_out.date() == day:
            return stay
    return None


def item_zone(item: Any, day: dt.date, stays: Iterable[Any], trip_zone: str) -> str:
    """An activity is on its place's clock, else its night's stay's, else the trip's."""
    own = place_zone(item.location) or item.timezone
    if own:
        return str(own)
    stay = night_stay(stays, day)
    return stay_zone(stay, trip_zone) if stay is not None else trip_zone
