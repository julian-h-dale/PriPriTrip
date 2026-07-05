"""Two-pass OpenAI translation of an itinerary document into a TripImport.

Pass 1 (structure): extracted document text -> structured trip (days/points/
locations) with concise factual data.
Pass 2 (enhance): expands day descriptions into exciting narrative summaries and
adds concise descriptions to points/locations.

The LLM works with an ID-free intermediate model (``AITrip``); UUIDs and the
day<->point linkage are assigned server-side in ``to_trip_import``.
"""

from __future__ import annotations

import os
import uuid
from typing import List, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel

from app.enums import LocationRole, PointType, StayType, TravelMode
from app.schemas import (
    LocationCreate,
    StayDetail,
    TravelDetail,
    TripDayImport,
    TripImport,
    TripPointCreate,
)

_DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-2024-08-06")


# ── ID-free intermediate model the LLM produces ──────────────────────────────

class AILocation(BaseModel):
    role: LocationRole
    name: str
    description: Optional[str] = None
    link: Optional[str] = None


class AIPoint(BaseModel):
    type: PointType
    title: str
    startDateTime: Optional[str] = None
    endDateTime: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: List[AILocation] = []
    travelDetail: Optional[TravelDetail] = None
    stayDetail: Optional[StayDetail] = None


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
    days: List[AIDay] = []


# ── Prompts ───────────────────────────────────────────────────────────────

_STRUCTURE_SYSTEM = """You convert a traveller's raw itinerary document into a structured trip.

Rules:
- Group everything into days. Each day has a title (e.g. "May 11 — Arrival in Bern") and an ISO date (YYYY-MM-DD).
- Each day has ordered points. A point is one of: "travel", "stay", or "activity".
- travel points: set travelDetail.mode (flight/train/car/bus/ferry/boat/walk/hike/other) and give locations roles origin/destination (waypoint if intermediate).
- stay points: set stayDetail.stayType (hotel/hostel/airbnb/rental/other) and give locations role "venue".
- activity points: locations use role "venue".
- Use ISO 8601 datetimes with a timezone offset when times are known (e.g. 2026-05-11T12:15:00+02:00); otherwise leave them null.
- Preserve confirmation numbers exactly.
- Keep descriptions short and factual at this stage; do not invent facts, times, or confirmation numbers.
- Do NOT fabricate coordinates or addresses; only include location names you can infer from the document.
Return ONLY data that is supported by the document."""

_ENHANCE_SYSTEM = """You are enhancing an already-structured trip to make it engaging.

For each day: write an exciting, vivid description (3-5 sentences) that summarises
the day's highlights and builds anticipation. Mention the key places and moments.

For each point and location: add a concise, helpful description (1-2 sentences) if
one is missing or thin. Keep point and location descriptions SHORTER than day descriptions.

Do NOT change any factual fields: titles, dates, times, types, modes, stayTypes,
confirmation numbers, or location names. Do NOT add or remove days, points, or
locations. Only improve the description fields. Return the full trip in the same structure."""


def _client():
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is not configured on the server.",
        )
    return OpenAI(api_key=api_key)


def _parse(client, system: str, user: str) -> AITrip:
    try:
        completion = client.beta.chat.completions.parse(
            model=_DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format=AITrip,
        )
    except Exception as exc:  # network / API errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI request failed: {exc}",
        ) from exc

    parsed = completion.choices[0].message.parsed
    if parsed is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI did not return a parseable trip.",
        )
    return parsed


def structure_itinerary(document_text: str, client=None) -> AITrip:
    client = client or _client()
    user = f"Itinerary document:\n\n{document_text}"
    return _parse(client, _STRUCTURE_SYSTEM, user)


def enhance_trip(trip: AITrip, client=None) -> AITrip:
    client = client or _client()
    user = "Structured trip to enhance:\n\n" + trip.model_dump_json(indent=2)
    return _parse(client, _ENHANCE_SYSTEM, user)


def to_trip_import(trip: AITrip) -> TripImport:
    """Assign UUIDs and wire day<->point linkage, producing a TripImport."""
    trip_id = str(uuid.uuid4())
    days: List[TripDayImport] = []

    for ai_day in trip.days:
        day_id = str(uuid.uuid4())
        points: List[TripPointCreate] = []
        for ai_point in ai_day.points:
            point_id = str(uuid.uuid4())
            locations = [
                LocationCreate(
                    locationId=str(uuid.uuid4()),
                    role=loc.role,
                    name=loc.name,
                    description=loc.description,
                    link=loc.link,
                )
                for loc in ai_point.locations
            ]
            points.append(
                TripPointCreate(
                    pointId=point_id,
                    dayId=day_id,
                    type=ai_point.type,
                    title=ai_point.title,
                    startDateTime=ai_point.startDateTime,
                    endDateTime=ai_point.endDateTime,
                    confirmationNumber=ai_point.confirmationNumber,
                    description=ai_point.description,
                    locations=locations,
                    travelDetail=ai_point.travelDetail,
                    stayDetail=ai_point.stayDetail,
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
        days=days,
    )


def build_trip_from_document(document_text: str, client=None) -> TripImport:
    """Full pipeline: structure -> enhance -> TripImport with IDs."""
    client = client or _client()
    structured = structure_itinerary(document_text, client=client)
    enhanced = enhance_trip(structured, client=client)
    return to_trip_import(enhanced)
