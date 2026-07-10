from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def _post_json(url: str, *, payload: dict, headers: dict[str, str]) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else {}


def resolve_location_candidates(query: str, *, region_code: str | None = None, max_candidates: int = 3) -> list[dict]:
    maps_api_key = os.environ.get("MAPS_API_KEY")
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
        data = _post_json(
            "https://places.googleapis.com/v1/places:searchText",
            payload=payload,
            headers=headers,
        )
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
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


def enrich_location_dict(loc: dict, *, region_code: str | None = None) -> dict:
    if not loc.get("name"):
        return loc
    if loc.get("googlePlaceId") and loc.get("lat") is not None and loc.get("lng") is not None:
        return loc

    candidates = resolve_location_candidates(loc["name"], region_code=region_code, max_candidates=1)
    if not candidates:
        return loc

    top = candidates[0]
    loc.setdefault("fullAddress", top.get("fullAddress"))
    loc.setdefault("googlePlaceId", top.get("googlePlaceId"))
    loc.setdefault("googleMapsUri", top.get("googleMapsUri"))
    loc.setdefault("lat", top.get("lat"))
    loc.setdefault("lng", top.get("lng"))
    return loc
