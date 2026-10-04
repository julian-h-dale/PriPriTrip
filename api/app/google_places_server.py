"""Server-side Google Places lookups — photo backfill only.

Two calls: `find_place_id` resolves a free-form name/address to a place id
when a location doesn't have one yet (imported or typed by hand, never
picked from Google); `fetch_first_photo_url` gets that place's first photo.

Everywhere else, this app deliberately never calls Google from the server
(see implementation_plan.md: "Google Places runs in the browser... we
considered a server-side proxy and rejected it"). This is the one exception,
used only by the standalone backfill script (app/backfill_photos.py), not by
any request path.

Uses the same browser Maps key (GOOGLE_MAPS_API_KEY) via plain server-side
HTTPS calls. Verified empirically against the live API: a key restricted to
"HTTP referrers (websites)" does not reject a request that sends no Referer
header at all — it only blocks a request whose Referer doesn't match the
allowlist. No second key, no header spoofing.

Best-effort only: every lookup swallows network/API errors and returns None.
A missing photo should never be treated as fatal by a caller.
"""

from __future__ import annotations

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
