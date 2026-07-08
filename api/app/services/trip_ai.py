"""Two-pass OpenAI translation of an itinerary document into a TripImport.

Pass 1 (structure): extracted document text -> structured trip (days/points/
locations) with concise factual data.
Pass 2 (enhance): expands day descriptions into exciting narrative summaries and
adds concise descriptions to points/locations.

The LLM works with an ID-free intermediate model (``AITrip``); UUIDs and the
day<->point linkage are assigned server-side in ``to_trip_import``.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import List, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel

from app.enums import LocationRole, PointType, StayType, TravelMode
from app.schemas import (
    LocationCreate,
    StayDetailImport,
    TravelDetailImport,
    TripDayImport,
    TripImport,
    TripPointCreate,
)

logger = logging.getLogger("app.trip_ai")

_DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4")
# Fail fast instead of hanging forever if OpenAI is slow/unreachable.
_REQUEST_TIMEOUT = float(os.environ.get("OPENAI_TIMEOUT", "120"))
_MAX_RETRIES = int(os.environ.get("OPENAI_MAX_RETRIES", "2"))


# ── ID-free intermediate model the LLM produces ──────────────────────────────

class AILocation(BaseModel):
    role: LocationRole
    name: str
    description: Optional[str] = None
    link: Optional[str] = None


class AIStay(BaseModel):
    ref: str  # temporary id the model assigns, referenced by points
    name: Optional[str] = None
    stayType: StayType
    checkIn: Optional[str] = None
    checkOut: Optional[str] = None
    roomType: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: List[AILocation] = []


class AITravel(BaseModel):
    ref: str  # temporary id the model assigns, referenced by points
    name: Optional[str] = None
    mode: TravelMode
    operator: Optional[str] = None
    vehicleNumber: Optional[str] = None
    cabinClass: Optional[str] = None
    departureDateTime: Optional[str] = None
    arrivalDateTime: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: List[AILocation] = []


class AIPoint(BaseModel):
    type: PointType
    title: str
    stayRef: Optional[str] = None  # -> AIStay.ref for check-in/check-out
    travelRef: Optional[str] = None  # -> AITravel.ref for departure/arrival
    startDateTime: Optional[str] = None
    endDateTime: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: List[AILocation] = []


class AIDay(BaseModel):
    title: str
    date: str
    description: Optional[str] = None
    isAlternate: bool = False
    points: List[AIPoint] = []


class AITrip(BaseModel):
    tripName: str
    startDate: str
    endDate: str
    stays: List[AIStay] = []
    travels: List[AITravel] = []
    days: List[AIDay] = []


# ── Prompts ───────────────────────────────────────────────────────────────

_STRUCTURE_SYSTEM = """You convert a traveller's raw itinerary document into a structured trip.

The trip has three top-level collections: stays, travels, and days.

STAYS (accommodation, one entry per booking that can span multiple nights):
- Give each a unique "ref" (e.g. "stay-1"), a "name" (the hotel/property name — this is the primary label),
  stayType (hotel/hostel/airbnb/rental/other), checkIn and checkOut as ISO datetimes, roomType, confirmationNumber.
- Put the property location under the stay's "locations" with role "venue".

TRAVELS (a flight, train, drive, etc.):
- Give each a unique "ref" (e.g. "travel-1"), a "name" (e.g. "Flight to Zurich"), mode
  (flight/train/car/bus/ferry/boat/walk/hike/other), operator, vehicleNumber, cabinClass,
  departureDateTime and arrivalDateTime as ISO datetimes, confirmationNumber.
- Put origin/destination (and any waypoints) under the travel's "locations" with roles origin/destination/waypoint.

DAYS contain ordered timeline POINTS. A point is an "action" of type:
  check-in | check-out | departure | arrival | activity
- A "check-in" or "check-out" point references a stay via stayRef.
- A "departure" or "arrival" point references a travel via travelRef.
- An "activity" point references neither; put its venue under the point's "locations" with role "venue".
- The point "title" is the action (e.g. "Check in", "Depart for Zurich"); the stay/travel "name" holds the entity label.

General:
- Treat all date-times as wall-clock local times from the itinerary text.
- Output date-times in local ISO shape without offset (e.g. 2026-05-11T12:15:00); otherwise null.
- Do not invent timezone offsets or convert times to UTC. Timezone inference is handled by import code.
- Preserve confirmation numbers exactly. Keep descriptions short and factual here.
- Do NOT fabricate coordinates or addresses; only include location names you can infer from the document.
Return ONLY data supported by the document."""

_ENHANCE_SYSTEM = """You are enhancing an already-structured trip to make it engaging.

For each day: write a SHORT, exciting description of just 2-3 sentences that
captures the vibe and the top highlights of the day. Keep it high-level — do NOT
put logistics, step-by-step instructions, or practical tips in the day description.

For each point, stay, and travel: this is where the detail belongs. Write a helpful,
vivid description that can be a bit longer, covering what to do or expect, practical
tips, timing guidance, and any useful step-by-step notes. Location descriptions
stay concise (1-2 sentences).

Do NOT change any factual fields: refs, titles, names, dates, times, types, modes,
stayTypes, confirmation numbers, or location names. Do NOT add or remove stays,
travels, days, points, or locations. Only improve the description fields. Return the
full trip in the same structure."""


def _client():
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is not configured on the server.",
        )
    return OpenAI(api_key=api_key, timeout=_REQUEST_TIMEOUT, max_retries=_MAX_RETRIES)


def _parse(client, system: str, user: str, *, pass_name: str) -> AITrip:
    logger.info(
        "OpenAI %s pass: model=%s prompt_chars=%d timeout=%.0fs",
        pass_name, _DEFAULT_MODEL, len(user), _REQUEST_TIMEOUT,
    )
    started = time.monotonic()
    try:
        completion = client.beta.chat.completions.parse(
            model=_DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format=AITrip,
        )
    except Exception as exc:  # network / API errors / timeout
        logger.exception("OpenAI %s pass failed after %.1fs", pass_name, time.monotonic() - started)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI request failed: {exc}",
        ) from exc

    elapsed = time.monotonic() - started
    usage = getattr(completion, "usage", None)
    finish = completion.choices[0].finish_reason if completion.choices else None
    logger.info(
        "OpenAI %s pass ok in %.1fs: finish_reason=%s usage=%s",
        pass_name, elapsed, finish,
        getattr(usage, "total_tokens", None) if usage else None,
    )

    message = completion.choices[0].message
    if getattr(message, "refusal", None):
        logger.warning("OpenAI %s pass refused: %s", pass_name, message.refusal)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI refused the request: {message.refusal}",
        )
    parsed = message.parsed
    if parsed is None:
        logger.warning("OpenAI %s pass returned no parseable content", pass_name)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI did not return a parseable trip.",
        )
    return parsed


def structure_itinerary(document_text: str, client=None) -> AITrip:
    client = client or _client()
    user = f"Itinerary document:\n\n{document_text}"
    return _parse(client, _STRUCTURE_SYSTEM, user, pass_name="structure")


def enhance_trip(trip: AITrip, client=None) -> AITrip:
    client = client or _client()
    user = "Structured trip to enhance:\n\n" + trip.model_dump_json(indent=2)
    return _parse(client, _ENHANCE_SYSTEM, user, pass_name="enhance")


def _ai_locations(ai_locs, *, stay_id=None, travel_id=None) -> List[LocationCreate]:
    return [
        LocationCreate(
            locationId=str(uuid.uuid4()),
            role=loc.role,
            name=loc.name,
            description=loc.description,
            link=loc.link,
        )
        for loc in ai_locs
    ]


def to_trip_import(trip: AITrip) -> TripImport:
    """Assign UUIDs, hoist stays/travels to trip level, and wire point refs."""
    trip_id = str(uuid.uuid4())

    # Map the model's temporary refs to generated UUIDs.
    stay_ref_to_id = {s.ref: str(uuid.uuid4()) for s in trip.stays}
    travel_ref_to_id = {t.ref: str(uuid.uuid4()) for t in trip.travels}

    stays: List[StayDetailImport] = [
        StayDetailImport(
            stayDetailId=stay_ref_to_id[s.ref],
            name=s.name,
            stayType=s.stayType,
            checkIn=s.checkIn,
            checkOut=s.checkOut,
            roomType=s.roomType,
            confirmationNumber=s.confirmationNumber,
            description=s.description,
            locations=_ai_locations(s.locations),
        )
        for s in trip.stays
    ]
    travels: List[TravelDetailImport] = [
        TravelDetailImport(
            travelDetailId=travel_ref_to_id[t.ref],
            name=t.name,
            mode=t.mode,
            operator=t.operator,
            vehicleNumber=t.vehicleNumber,
            cabinClass=t.cabinClass,
            departureDateTime=t.departureDateTime,
            arrivalDateTime=t.arrivalDateTime,
            confirmationNumber=t.confirmationNumber,
            description=t.description,
            locations=_ai_locations(t.locations),
        )
        for t in trip.travels
    ]

    days: List[TripDayImport] = []
    for ai_day in trip.days:
        day_id = str(uuid.uuid4())
        points: List[TripPointCreate] = []
        for ai_point in ai_day.points:
            points.append(
                TripPointCreate(
                    pointId=str(uuid.uuid4()),
                    dayId=day_id,
                    type=ai_point.type,
                    title=ai_point.title,
                    stayDetailId=stay_ref_to_id.get(ai_point.stayRef) if ai_point.stayRef else None,
                    travelDetailId=travel_ref_to_id.get(ai_point.travelRef) if ai_point.travelRef else None,
                    startDateTime=ai_point.startDateTime,
                    endDateTime=ai_point.endDateTime,
                    confirmationNumber=ai_point.confirmationNumber,
                    description=ai_point.description,
                    locations=_ai_locations(ai_point.locations),
                )
            )
        days.append(
            TripDayImport(
                dayId=day_id,
                title=ai_day.title,
                date=ai_day.date,
                description=ai_day.description,
                isAlternate=ai_day.isAlternate,
                points=points,
            )
        )

    return TripImport(
        tripId=trip_id,
        tripName=trip.tripName,
        startDate=trip.startDate,
        endDate=trip.endDate,
        stays=stays,
        travels=travels,
        days=days,
    )


def build_trip_from_document(document_text: str, client=None) -> TripImport:
    """Full pipeline: structure -> enhance -> TripImport with IDs."""
    client = client or _client()
    logger.info("pipeline start: structuring itinerary (%d chars)", len(document_text))
    structured = structure_itinerary(document_text, client=client)
    logger.info(
        "pipeline: structured %d days, %d points; starting enhance pass",
        len(structured.days),
        sum(len(d.points) for d in structured.days),
    )
    enhanced = enhance_trip(structured, client=client)
    logger.info("pipeline: enhance pass complete; assembling TripImport")
    return to_trip_import(enhanced)


def structure_document(document_text: str, client=None) -> TripImport:
    """Pass 1 only: structure a document into a TripImport draft (no enhance)."""
    client = client or _client()
    logger.info("structure-only: structuring itinerary (%d chars)", len(document_text))
    structured = structure_itinerary(document_text, client=client)
    logger.info(
        "structure-only: produced %d days, %d points",
        len(structured.days),
        sum(len(d.points) for d in structured.days),
    )
    return to_trip_import(structured)


def _ai_locs_from(locations) -> List[AILocation]:
    return [
        AILocation(role=loc.role, name=loc.name, description=loc.description, link=loc.link)
        for loc in locations
    ]


def _trip_import_to_ai(trip: TripImport) -> AITrip:
    """Convert a TripImport (with IDs) back into the ID-free AITrip model.

    Detail IDs are reused as the temporary refs so points keep their linkage.
    """
    return AITrip(
        tripName=trip.tripName,
        startDate=trip.startDate,
        endDate=trip.endDate,
        stays=[
            AIStay(
                ref=s.stayDetailId,
                name=s.name,
                stayType=s.stayType,
                checkIn=s.checkIn,
                checkOut=s.checkOut,
                roomType=s.roomType,
                confirmationNumber=s.confirmationNumber,
                description=s.description,
                locations=_ai_locs_from(s.locations),
            )
            for s in trip.stays
        ],
        travels=[
            AITravel(
                ref=t.travelDetailId,
                name=t.name,
                mode=t.mode,
                operator=t.operator,
                vehicleNumber=t.vehicleNumber,
                cabinClass=t.cabinClass,
                departureDateTime=t.departureDateTime,
                arrivalDateTime=t.arrivalDateTime,
                confirmationNumber=t.confirmationNumber,
                description=t.description,
                locations=_ai_locs_from(t.locations),
            )
            for t in trip.travels
        ],
        days=[
            AIDay(
                title=day.title,
                date=day.date,
                description=day.description,
                isAlternate=day.isAlternate,
                points=[
                    AIPoint(
                        type=pt.type,
                        title=pt.title,
                        stayRef=pt.stayDetailId,
                        travelRef=pt.travelDetailId,
                        startDateTime=pt.startDateTime,
                        endDateTime=pt.endDateTime,
                        confirmationNumber=pt.confirmationNumber,
                        description=pt.description,
                        locations=_ai_locs_from(pt.locations),
                    )
                    for pt in day.points
                ],
            )
            for day in trip.days
        ],
    )


def enhance_trip_import(trip: TripImport, client=None) -> TripImport:
    """Pass 2 only: enhance descriptions of an existing trip, preserving IDs.

    The enhance pass only touches description fields and does not add/remove
    entities, so enhanced text is merged back into the original TripImport by
    position — keeping every existing ID intact.
    """
    client = client or _client()
    logger.info(
        "enhance-only: enhancing trip=%r (%d stays, %d travels, %d days)",
        trip.tripName, len(trip.stays), len(trip.travels), len(trip.days),
    )
    enhanced = enhance_trip(_trip_import_to_ai(trip), client=client)

    def _merge_locs(locs, ai_locs):
        for loc, ai_loc in zip(locs, ai_locs):
            if ai_loc.description:
                loc.description = ai_loc.description

    result = trip.model_copy(deep=True)
    for stay, ai_stay in zip(result.stays, enhanced.stays):
        if ai_stay.description:
            stay.description = ai_stay.description
        _merge_locs(stay.locations, ai_stay.locations)
    for travel, ai_travel in zip(result.travels, enhanced.travels):
        if ai_travel.description:
            travel.description = ai_travel.description
        _merge_locs(travel.locations, ai_travel.locations)
    for day, ai_day in zip(result.days, enhanced.days):
        if ai_day.description:
            day.description = ai_day.description
        for pt, ai_pt in zip(day.points, ai_day.points):
            if ai_pt.description:
                pt.description = ai_pt.description
            _merge_locs(pt.locations, ai_pt.locations)
    logger.info("enhance-only: merged enhancements back into trip=%r", result.tripName)
    return result
