"""Google Places resolution for assistant-provided location names.

Async (httpx) so it never blocks the event loop — this runs inside chat-turn
handling. The chat contract deliberately does not let the model supply
lat/lng/place IDs (review.md 3C-6), so every model-named location passes
through here for authoritative metadata.

Resolution is no longer silent (review.md 3F-5). Every lookup is classified:

- **high**   — one clear winner. Applied, and the assistant is told what it
               assumed so it can say so.
- **medium** — several plausible places. NOT applied; the caller offers the
               user a choice instead of guessing.
- **low**    — nothing found. The raw name is kept and the assistant asks.

The rule that decides "clear winner" is `classify()` below, and it is the only
place that judgement is made.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher
import logging
import re
import unicodedata

import httpx

from app.settings import get_settings

logger = logging.getLogger("app.services.location_resolver")

_PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
_PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"
_REQUEST_TIMEOUT_SECONDS = 8.0
_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri"

# ── The "clear winner" rule (review.md 3F-5) ────────────────────────────────
# Google returns a ranked list but no confidence score, so we compute one.
# Two things can make a match a "clear winner", and in practice the *second*
# does most of the work:
#
# 1. The user named the place almost exactly. TOP_MATCH_MIN is the bar, and it
#    is deliberately high because `similarity` compares whole strings: a short
#    query against a long official name scores low even when it is a perfect
#    prefix. Measured: "Naha airport" -> "Naha Airport" = 1.00 and
#    "Ritz Carlton Kyoto" -> "The Ritz-Carlton, Kyoto" = 1.00 (normalization
#    removes the punctuation and "the"), but "the Hyatt" -> "Hyatt Regency
#    Naha, Okinawa" = 0.32. So this bar clears only when the user was specific,
#    which is exactly when we are entitled to pick for them. LEAD_MIN then
#    keeps it from firing on a near-tie.
#
# 2. Google, searching near the trip's destination, found only one such place.
#    Then there is nothing to disambiguate and the score is irrelevant — see
#    the len(scored) == 1 branch in classify(). This is the common "high" path:
#    "the Sheraton" on an Okinawa trip scores just 0.39 against "Sheraton
#    Okinawa Sunmarina Resort", but it is the only Sheraton in Okinawa, so we
#    take it and tell the user what we assumed.
#
# Anything else — two Hyatts in Okinawa, both scoring ~0.3 — is a choice, not
# a guess. These two numbers are tuned judgement, not derived; they are named
# constants so they can be moved when real usage says they should be.
TOP_MATCH_MIN = 0.72
LEAD_MIN = 0.15

_NOISE_WORDS = {"the", "a", "an", "at", "in", "hotel", "airport"}


def _normalize(text: str) -> str:
    """Case, accents, punctuation and filler words are not signal."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^\w\s]", " ", text.lower())
    words = [w for w in text.split() if w not in _NOISE_WORDS]
    return " ".join(words) or " ".join(text.split())


def similarity(query: str, name: str) -> float:
    """0..1 similarity between what the user said and a candidate's name."""
    return SequenceMatcher(None, _normalize(query), _normalize(name)).ratio()


@dataclass
class LocationResolution:
    query: str
    confidence: str  # "high" | "medium" | "low"
    chosen: dict | None = None  # set only when confidence == "high"
    candidates: list[dict] = field(default_factory=list)

    @property
    def is_ambiguous(self) -> bool:
        return self.confidence == "medium"


def classify(query: str, candidates: list[dict]) -> LocationResolution:
    """Decide whether we may pick for the user, must ask, or found nothing."""
    if not candidates:
        return LocationResolution(query=query, confidence="low")

    scored = sorted(
        ((similarity(query, c.get("name") or ""), c) for c in candidates),
        key=lambda pair: pair[0],
        reverse=True,
    )
    top_score, top = scored[0]

    # Only one place answers to that name — nothing to disambiguate.
    if len(scored) == 1:
        return LocationResolution(query=query, confidence="high", chosen=top, candidates=[top])

    runner_score = scored[1][0]
    clear_winner = top_score >= TOP_MATCH_MIN and (top_score - runner_score) >= LEAD_MIN

    ordered = [c for _score, c in scored]
    if clear_winner:
        return LocationResolution(query=query, confidence="high", chosen=top, candidates=ordered)
    return LocationResolution(query=query, confidence="medium", candidates=ordered)


def _bias_query(query: str, near: str | None) -> str:
    """Search "the Hyatt" near the trip's destination, not near nothing.

    Text Search is a natural-language endpoint, so the destination goes into
    the query itself — but only when the user did not already name a place.
    """
    if not near:
        return query
    query_words = set(_normalize(query).split())
    near_words = set(_normalize(near).split())
    if near_words & query_words:
        return query  # they already said where
    return f"{query} {near}".strip()


async def resolve_location_candidates(
    query: str,
    *,
    near: str | None = None,
    region_code: str | None = None,
    max_candidates: int = 3,
) -> list[dict]:
    maps_api_key = get_settings().maps_api_key
    if not maps_api_key:
        return []

    payload = {
        "textQuery": _bias_query(query, near),
        "pageSize": max(1, min(max_candidates, 5)),
    }
    if region_code:
        payload["regionCode"] = region_code

    headers = {"X-Goog-Api-Key": maps_api_key, "X-Goog-FieldMask": _FIELD_MASK}

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


async def resolve_location(
    query: str,
    *,
    near: str | None = None,
    max_candidates: int = 3,
) -> LocationResolution:
    """Look a place up and say how sure we are."""
    candidates = await resolve_location_candidates(query, near=near, max_candidates=max_candidates)
    return classify(query, candidates)


async def place_details(place_id: str) -> dict | None:
    """Authoritative metadata for a place the *user* picked from a choice."""
    maps_api_key = get_settings().maps_api_key
    if not maps_api_key or not place_id:
        return None

    headers = {
        "X-Goog-Api-Key": maps_api_key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location,googleMapsUri",
    }
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            resp = await client.get(_PLACE_DETAILS_URL.format(place_id=place_id), headers=headers)
            resp.raise_for_status()
            place = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Place details failed for %r: %s", place_id, exc)
        return None

    loc = place.get("location") or {}
    return {
        "name": (place.get("displayName") or {}).get("text"),
        "fullAddress": place.get("formattedAddress"),
        "googlePlaceId": place.get("id") or place_id,
        "googleMapsUri": place.get("googleMapsUri"),
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
    }


_RESOLVED_FIELDS = ("fullAddress", "googlePlaceId", "googleMapsUri", "lat", "lng")


def apply_resolution(loc: dict, resolved: dict) -> dict:
    """Write authoritative metadata onto a location dict.

    Fills a field that is missing *or* explicitly None. `setdefault` was not
    enough: a location that came through a Pydantic model carries every key
    with a None value, so the resolved metadata was silently dropped and
    chat-created places ended up with no coordinates at all.
    """
    for key in _RESOLVED_FIELDS:
        if loc.get(key) in (None, ""):
            loc[key] = resolved.get(key)
    return loc


async def enrich_location_dict(
    loc: dict,
    *,
    near: str | None = None,
    region_code: str | None = None,
) -> tuple[dict, LocationResolution | None]:
    """Resolve a location for a write, and report what was decided.

    A **high**-confidence match is applied. A **medium** one is deliberately
    NOT applied — the caller offers the user a choice rather than guessing,
    which is what this used to do silently (review.md 3F-5).
    """
    if not loc.get("name"):
        return loc, None
    if loc.get("googlePlaceId") and loc.get("lat") is not None and loc.get("lng") is not None:
        return loc, None  # the user already picked a real place

    resolution = await resolve_location(loc["name"], near=near)
    if resolution.confidence == "high" and resolution.chosen:
        apply_resolution(loc, resolution.chosen)
    return loc, resolution
