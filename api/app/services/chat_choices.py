"""Location disambiguation as a `choice` uiPayload (review.md 3F-5).

When a location the assistant wrote is ambiguous — several plausible places
answer to "the Sheraton" — the backend no longer picks candidate #1 in silence.
It leaves the location unresolved and offers the user the candidates.

The loop this closes matters. The model may only supply a location *name*
(place IDs are stripped from its contract because models invent them, 3C-6),
so a name the model "disambiguated" used to be re-resolved on write and could
land somewhere else. A choice carries the **place id we ourselves looked up**,
so the user's tap decides the record — no re-guessing, and no model call.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LocationRecord, TripRecord
from app.schemas import ChatChoice, ChatChoiceOption
from app.services.llm_contract import LocationDecision
from app.services.location_resolver import apply_resolution, place_details
from app.services.timezones import tzid_from_coords


class ChoiceError(ValueError):
    """A choice submission we cannot honour."""


def build_choice(decision: LocationDecision) -> ChatChoice:
    """Turn an ambiguous resolution into something the user can tap."""
    options = [
        ChatChoiceOption(
            optionId=candidate["googlePlaceId"],
            label=candidate.get("name") or decision.query,
            sublabel=candidate.get("fullAddress"),
            mapsUri=candidate.get("googleMapsUri"),
        )
        for candidate in decision.candidates
        if candidate.get("googlePlaceId")
    ]
    return ChatChoice(
        choiceId=str(uuid.uuid4()),
        prompt=f"Which {decision.query} did you mean?",
        locationId=decision.location_id,
        query=decision.query,
        options=options,
    )


async def apply_choice(
    db: AsyncSession,
    *,
    trip: TripRecord,
    choice: dict,
    option_id: str,
) -> LocationRecord:
    """Write the place the user picked onto the location row.

    `choice` is the payload we issued and stored with the message, so the
    option is checked against what we actually offered — a client cannot post
    an arbitrary place id.
    """
    offered = {opt.get("optionId") for opt in choice.get("options", [])}
    if option_id not in offered:
        raise ChoiceError("That option was not one of the choices offered.")

    location = await db.get(LocationRecord, choice["locationId"])
    if location is None:
        raise ChoiceError("That location no longer exists.")

    # The location must still belong to this trip, whichever record owns it.
    owner_trip_id = await _owner_trip_id(db, location)
    if owner_trip_id != trip.trip_id:
        raise ChoiceError("That location is not on this trip.")

    resolved = await place_details(option_id)
    if resolved is None:
        raise ChoiceError("Could not look that place up. Please try again.")

    # setdefault-style application expects a dict; write straight to the row.
    fields = apply_resolution({}, resolved)
    location.name = resolved.get("name") or location.name
    location.full_address = fields.get("fullAddress")
    location.google_place_id = fields.get("googlePlaceId")
    location.google_maps_uri = fields.get("googleMapsUri")
    location.lat = fields.get("lat")
    location.lng = fields.get("lng")
    location.timezone_id = tzid_from_coords(location.lat, location.lng) or location.timezone_id
    await db.flush()
    return location


async def _owner_trip_id(db: AsyncSession, location: LocationRecord) -> str | None:
    from app.models import StayDetailRecord, TravelDetailRecord, TripPointRecord

    if location.point_id:
        owner = await db.get(TripPointRecord, location.point_id)
    elif location.stay_detail_id:
        owner = await db.get(StayDetailRecord, location.stay_detail_id)
    elif location.travel_detail_id:
        owner = await db.get(TravelDetailRecord, location.travel_detail_id)
    else:
        return None
    return owner.trip_id if owner else None
