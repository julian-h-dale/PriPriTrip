"""Google Places resolution for assistant-provided location names.

Async (httpx) so it never blocks the event loop — this runs inside chat-turn
handling. The chat contract deliberately does not let the model supply
lat/lng/place IDs (review.md 3C-6), so every model-named location passes
through here for authoritative metadata.
"""

from __future__ import annotations

import logging

import httpx

from app.settings import get_settings

logger = logging.getLogger("app.services.location_resolver")

_PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
_REQUEST_TIMEOUT_SECONDS = 8.0


async def resolve_location_candidates(
    query: str,
    *,
    region_code: str | None = None,
    max_candidates: int = 3,
) -> list[dict]:
    maps_api_key = get_settings().maps_api_key
    if not maps_api_key:
        return []

    payload = {"textQuery": query, "pageSize": max(1, min(max_candidates, 5))}
    if region_code:
        payload["regionCode"] = region_code

    headers = {
        "X-Goog-Api-Key": maps_api_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.formattedAddress,"
            "places.location,places.googleMapsUri"
        ),
    }

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            resp = await client.post(_PLACES_SEARCH_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Places lookup failed for %r: %s", query, exc)
        return []

    candidates: list[dict] = []
    for place in data.get("places", [])[:max_candidates]:
        loc = place.get("location") or {}
        candidates.append(
            {
                "name": (place.get("displayName") or {}).get("text") or query,
                "fullAddress": place.get("formattedAddress"),
                "googlePlaceId": place.get("id"),
                "googleMapsUri": place.get("googleMapsUri"),
                "lat": loc.get("latitude"),
                "lng": loc.get("longitude"),
            }
        )

    return candidates


async def enrich_location_dict(loc: dict, *, region_code: str | None = None) -> dict:
    if not loc.get("name"):
        return loc
    if loc.get("googlePlaceId") and loc.get("lat") is not None and loc.get("lng") is not None:
        return loc

    candidates = await resolve_location_candidates(loc["name"], region_code=region_code, max_candidates=1)
    if not candidates:
        return loc

    top = candidates[0]
    loc.setdefault("fullAddress", top.get("fullAddress"))
    loc.setdefault("googlePlaceId", top.get("googlePlaceId"))
    loc.setdefault("googleMapsUri", top.get("googleMapsUri"))
    loc.setdefault("lat", top.get("lat"))
    loc.setdefault("lng", top.get("lng"))
    return loc
