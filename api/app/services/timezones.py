from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from timezonefinder import TimezoneFinder

_tf = TimezoneFinder(in_memory=True)


def parse_wall_clock(value: str | None) -> datetime | None:
    """Parse incoming datetime text as wall-clock.

    Accepts both offset-aware and naive ISO strings. For offset-aware input,
    preserves the local wall-clock component (drops offset semantics).
    """
    if not value:
        return None

    text = value.strip()
    if not text:
        return None

    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None

    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt


def wall_clock_to_text(local_dt: datetime | None) -> str | None:
    if local_dt is None:
        return None
    return local_dt.isoformat(timespec="minutes")


def tzid_from_coords(lat: float | None, lng: float | None) -> str | None:
    if lat is None or lng is None:
        return None
    try:
        return _tf.timezone_at(lat=lat, lng=lng)
    except Exception:
        return None


_CAMEL_TO_SNAKE = {
    "locationId": "location_id",
    "fullAddress": "full_address",
    "googlePlaceId": "google_place_id",
    "googleMapsUri": "google_maps_uri",
    "timezoneId": "timezone_id",
}


def _loc_get(loc, name: str):
    """Read a location attribute from a dict (camelCase keys), a snake_case
    pydantic/ORM object, or a legacy camelCase object."""
    if isinstance(loc, dict):
        return loc.get(name)
    value = getattr(loc, name, None)
    if value is None and name in _CAMEL_TO_SNAKE:
        value = getattr(loc, _CAMEL_TO_SNAKE[name], None)
    return value


def location_tzid(loc) -> str | None:
    """Timezone id for a location (pydantic object, ORM row, or dict).

    Prefers an explicit timezoneId, falling back to coordinate lookup.
    """
    return _loc_get(loc, "timezoneId") or tzid_from_coords(_loc_get(loc, "lat"), _loc_get(loc, "lng"))


def infer_tzid_from_locations(locations, *, role: str | None = None, fallback: str | None = None) -> str | None:
    """First resolvable timezone id among locations (optionally filtered by role)."""
    for loc in locations or []:
        if role and _loc_get(loc, "role") != role:
            continue
        tzid = location_tzid(loc)
        if tzid:
            return tzid
    return fallback


def derive_utc(local_dt: datetime | None, tzid: str | None) -> datetime | None:
    if local_dt is None or not tzid:
        return None
    try:
        zone = ZoneInfo(tzid)
    except Exception:
        return None

    # Use fold=0 policy for ambiguous local times.
    localized = local_dt.replace(tzinfo=zone, fold=0)
    return localized.astimezone(ZoneInfo("UTC"))
