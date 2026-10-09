"""Server-side Google Places lookups.

- `find_place_id` resolves a free-form name/address to a place id when a
  location doesn't have one yet (imported or typed by hand, never picked
  from Google); `fetch_first_photo_url` gets that place's first photo. Both
  are used only by the standalone backfill script (app/backfill_photos.py).
- `nearby_place` names where a journal memory was written ("Café Central",
  "Innere Stadt, Vienna"). It runs as a background task after a memory with
  a location is saved (Run stage 26), and from `make backfill-places`.

Everything else about places (search, the map) runs in the browser.

Uses the same browser Maps key (GOOGLE_MAPS_API_KEY) via plain server-side
HTTPS calls. Verified empirically against the live API: a key restricted to
"HTTP referrers (websites)" does not reject a request that sends no Referer
header at all — it only blocks a request whose Referer doesn't match the
allowlist. No second key, no header spoofing.

Best-effort only: every lookup swallows network/API errors and returns None.
A missing photo should never be treated as fatal by a caller.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.settings import get_app_settings

PLACES_BASE = "https://places.googleapis.com/v1"


async def find_place_id(query: str) -> str | None:
    """The top Google Places text-search match for a free-form query (e.g. a
    location's name plus its address or city), or None for no match/error.
    """
    api_key = get_app_settings().google_maps_api_key
    if not api_key or not query:
        return None

    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "places.id",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                f"{PLACES_BASE}/places:searchText", headers=headers, json={"textQuery": query}
            )
            resp.raise_for_status()
            places = resp.json().get("places") or []
            return places[0]["id"] if places else None
        except httpx.HTTPError:
            return None


async def fetch_first_photo_url(place_id: str, *, max_width_px: int = 800) -> str | None:
    """The first photo Google has for a place, as a ready-to-use image URL."""
    api_key = get_app_settings().google_maps_api_key
    if not api_key or not place_id:
        return None

    headers = {"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": "photos"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            details = await client.get(f"{PLACES_BASE}/places/{place_id}", headers=headers)
            details.raise_for_status()
            photos = details.json().get("photos") or []
            if not photos:
                return None

            media = await client.get(
                f"{PLACES_BASE}/{photos[0]['name']}/media",
                params={"key": api_key, "maxWidthPx": max_width_px, "skipHttpRedirect": "true"},
            )
            media.raise_for_status()
            return media.json().get("photoUri")
        except httpx.HTTPError:
            return None


# Address component types that describe an area, not a place you'd name.
_AREA_TYPES = {
    "political",
    "locality",
    "sublocality",
    "neighborhood",
    "postal_town",
    "postal_code",
    "country",
    "route",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "administrative_area_level_3",
}
# The wider search when nothing is close enough to name: area only.
AREA_RADIUS_M = 1000.0


@dataclass
class NearbyPlace:
    name: str | None  # the closest place within the radius, if any
    area: str | None  # "Innere Stadt, Vienna"


def _component(components: list[dict[str, Any]], *types: str) -> str | None:
    for wanted in types:
        for c in components:
            if wanted in (c.get("types") or []) and c.get("longText"):
                return str(c["longText"])
    return None


def area_of(components: list[dict[str, Any]]) -> str | None:
    """Neighbourhood (or district) and town from a place's address parts."""
    parts = [
        _component(components, "neighborhood", "sublocality_level_1", "sublocality"),
        _component(components, "locality", "postal_town", "administrative_area_level_2"),
    ]
    named = [p for i, p in enumerate(parts) if p and p not in parts[:i]]
    return ", ".join(named) or None


async def _search_nearby(
    client: httpx.AsyncClient, api_key: str, lat: float, lng: float, radius_m: float
) -> list[dict[str, Any]]:
    resp = await client.post(
        f"{PLACES_BASE}/places:searchNearby",
        headers={
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": (
                "places.displayName,places.types,places.addressComponents,places.userRatingCount"
            ),
            "Content-Type": "application/json",
        },
        json={
            "locationRestriction": {
                "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius_m}
            },
            "rankPreference": "DISTANCE",
            "maxResultCount": 10,
            "languageCode": "en",
        },
    )
    resp.raise_for_status()
    return list(resp.json().get("places") or [])


async def nearby_place(lat: float, lng: float, radius_m: float) -> NearbyPlace | None:
    """The place you were most likely at within `radius_m` of a point, and its
    area: of the ten closest real places (not districts or streets), the one
    with the most reviews, so Café Central beats the office upstairs. When
    nothing is that close, the area alone (from a 1 km search). None when
    there's no key, nothing at all, or Google fails."""
    api_key = get_app_settings().google_maps_api_key
    if not api_key:
        return None
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            places = await _search_nearby(client, api_key, lat, lng, radius_m)
            named = [
                p
                for p in places
                if _AREA_TYPES.isdisjoint(p.get("types") or [])
                and (p.get("displayName") or {}).get("text")
            ]
            if named:
                # max() keeps the first (closest) of equals.
                best = max(named, key=lambda p: p.get("userRatingCount") or 0)
                return NearbyPlace(
                    name=best["displayName"]["text"],
                    area=area_of(best.get("addressComponents") or []),
                )
            wider = places or await _search_nearby(client, api_key, lat, lng, AREA_RADIUS_M)
            for place in wider:
                area = area_of(place.get("addressComponents") or [])
                if area:
                    return NearbyPlace(name=None, area=area)
            return None
        except (httpx.HTTPError, ValueError, KeyError):
            return None
