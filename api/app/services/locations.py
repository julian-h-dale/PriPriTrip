"""Shared LocationRecord row construction (review.md 1C-2).

One place that turns LocationCreate-like payloads (pydantic objects or plain
dicts) into LocationRecord rows for an owner (point, stay detail, or travel
detail). sort_order follows payload order; timezone falls back to coordinate
lookup when not supplied.
"""

from __future__ import annotations

from app.models import LocationRecord
from app.services.timezones import _loc_get, location_tzid


def location_rows(
    locations,
    *,
    point_id: str | None = None,
    stay_detail_id: str | None = None,
    travel_detail_id: str | None = None,
) -> list[LocationRecord]:
    return [
        LocationRecord(
            location_id=_loc_get(loc, "locationId"),
            point_id=point_id,
            stay_detail_id=stay_detail_id,
            travel_detail_id=travel_detail_id,
            role=_loc_get(loc, "role"),
            sort_order=index,
            name=_loc_get(loc, "name"),
            lat=_loc_get(loc, "lat"),
            lng=_loc_get(loc, "lng"),
            full_address=_loc_get(loc, "fullAddress"),
            description=_loc_get(loc, "description"),
            link=_loc_get(loc, "link"),
            google_place_id=_loc_get(loc, "googlePlaceId"),
            google_maps_uri=_loc_get(loc, "googleMapsUri"),
            timezone_id=location_tzid(loc),
        )
        for index, loc in enumerate(locations or [])
    ]
