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
import uuid
from typing import List, Optional

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
from app.services.openai_client import get_async_client, parse_structured

logger = logging.getLogger("app.trip_ai")


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


class AIDocumentExtract(BaseModel):
    stays: List[AIStay] = []
    travels: List[AITravel] = []


class AIDocumentDraft(BaseModel):
    stays: List[StayDetailImport] = []
    travels: List[TravelDetailImport] = []


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

_DOCUMENT_SYSTEM = """You convert a single reservation or ticket document into structured stay/travel records.

Return ONLY top-level collections:
- stays: hotel/accommodation reservations only
- travels: transport reservations only

Date/time rules:
- Treat all date-times as wall-clock local times from the document text.
- Output date-times in local ISO shape WITHOUT timezone offset (for example 2026-05-11T12:15:00).
- Do not invent timezone offsets and do not convert to UTC.

Stays:
- Use fields: name, stayType, checkIn, checkOut, roomType, confirmationNumber, description, locations.
- Put the property location in locations with role=venue.

Travels:
- Use fields: name, mode, operator, vehicleNumber, cabinClass, departureDateTime, arrivalDateTime,
  confirmationNumber, description, locations.
- Put main boarding location as role=origin and destination as role=destination.
- Include role=waypoint only when clearly present.

General:
- Preserve confirmation numbers exactly.
- Keep descriptions concise and factual.
- Do not fabricate lat/lng, addresses, or links.
- If a value is unknown, return null.
"""


async def _parse(client, system: str, user: str, *, pass_name: str) -> AITrip:
    """Structured itinerary pass via the shared async OpenAI helper."""
    return await parse_structured(
        client,
        system=system,
        user=user,
        response_format=AITrip,
        pass_name=pass_name,
        event_prefix="ai.trip_import.openai",
    )


async def _parse_document(client, system: str, user: str, *, pass_name: str) -> AIDocumentExtract:
    """Structured single-document pass via the shared async OpenAI helper."""
    return await parse_structured(
        client,
        system=system,
        user=user,
        response_format=AIDocumentExtract,
        pass_name=pass_name,
        event_prefix="ai.document_import.openai",
    )


async def structure_itinerary(document_text: str, client=None) -> AITrip:
    client = client or get_async_client()
    user = f"Itinerary document:\n\n{document_text}"
    return await _parse(client, _STRUCTURE_SYSTEM, user, pass_name="structure")


async def enhance_trip(trip: AITrip, client=None) -> AITrip:
    client = client or get_async_client()
    user = "Structured trip to enhance:\n\n" + trip.model_dump_json(indent=2)
    return await _parse(client, _ENHANCE_SYSTEM, user, pass_name="enhance")


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


async def build_trip_from_document(document_text: str, client=None) -> TripImport:
    """Full pipeline: structure -> enhance -> TripImport with IDs."""
    client = client or get_async_client()
    logger.info("pipeline start: structuring itinerary (%d chars)", len(document_text))
    structured = await structure_itinerary(document_text, client=client)
    logger.info(
        "pipeline: structured %d days, %d points; starting enhance pass",
        len(structured.days),
        sum(len(d.points) for d in structured.days),
    )
    enhanced = await enhance_trip(structured, client=client)
    logger.info("pipeline: enhance pass complete; assembling TripImport")
    return to_trip_import(enhanced)


async def structure_document(document_text: str, client=None) -> TripImport:
    """Pass 1 only: structure a document into a TripImport draft (no enhance)."""
    client = client or get_async_client()
    logger.info("structure-only: structuring itinerary (%d chars)", len(document_text))
    structured = await structure_itinerary(document_text, client=client)
    logger.info(
        "structure-only: produced %d days, %d points",
        len(structured.days),
        sum(len(d.points) for d in structured.days),
    )
    return to_trip_import(structured)


async def extract_document_records(document_text: str, client=None) -> AIDocumentDraft:
    """Extract only stays/travels from a single uploaded reservation/ticket document."""
    client = client or get_async_client()
    user = f"Document text:\n\n{document_text}"
    parsed = await _parse_document(client, _DOCUMENT_SYSTEM, user, pass_name="document")

    stays: List[StayDetailImport] = []
    for s in parsed.stays:
        stays.append(
            StayDetailImport(
                stayDetailId=str(uuid.uuid4()),
                name=s.name,
                stayType=s.stayType,
                checkIn=s.checkIn,
                checkOut=s.checkOut,
                roomType=s.roomType,
                confirmationNumber=s.confirmationNumber,
                description=s.description,
                locations=_ai_locations(s.locations),
            )
        )

    travels: List[TravelDetailImport] = []
    for t in parsed.travels:
        travels.append(
            TravelDetailImport(
                travelDetailId=str(uuid.uuid4()),
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
        )

    return AIDocumentDraft(
        stays=stays,
        travels=travels,
    )


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
        tripName=trip.trip_name,
        startDate=trip.start_date,
        endDate=trip.end_date,
        stays=[
            AIStay(
                ref=s.stay_detail_id,
                name=s.name,
                stayType=s.stay_type,
                checkIn=s.check_in,
                checkOut=s.check_out,
                roomType=s.room_type,
                confirmationNumber=s.confirmation_number,
                description=s.description,
                locations=_ai_locs_from(s.locations),
            )
            for s in trip.stays
        ],
        travels=[
            AITravel(
                ref=t.travel_detail_id,
                name=t.name,
                mode=t.mode,
                operator=t.operator,
                vehicleNumber=t.vehicle_number,
                cabinClass=t.cabin_class,
                departureDateTime=t.departure_date_time,
                arrivalDateTime=t.arrival_date_time,
                confirmationNumber=t.confirmation_number,
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
                isAlternate=day.is_alternate,
                points=[
                    AIPoint(
                        type=pt.type,
                        title=pt.title,
                        stayRef=pt.stay_detail_id,
                        travelRef=pt.travel_detail_id,
                        startDateTime=pt.start_date_time,
                        endDateTime=pt.end_date_time,
                        confirmationNumber=pt.confirmation_number,
                        description=pt.description,
                        locations=_ai_locs_from(pt.locations),
                    )
                    for pt in day.points
                ],
            )
            for day in trip.days
        ],
    )


async def enhance_trip_import(trip: TripImport, client=None) -> TripImport:
    """Pass 2 only: enhance descriptions of an existing trip, preserving IDs.

    The enhance pass only touches description fields and does not add/remove
    entities, so enhanced text is merged back into the original TripImport by
    position — keeping every existing ID intact.
    """
    client = client or get_async_client()
    logger.info(
        "enhance-only: enhancing trip=%r (%d stays, %d travels, %d days)",
        trip.trip_name, len(trip.stays), len(trip.travels), len(trip.days),
    )
    enhanced = await enhance_trip(_trip_import_to_ai(trip), client=client)

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
    logger.info("enhance-only: merged enhancements back into trip=%r", result.trip_name)
    return result
