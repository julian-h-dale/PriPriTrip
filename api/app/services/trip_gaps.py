"""What's missing from a trip, in a shape the user can fix in one tap.

`trip_verify` answers "is this trip sound?" — overlapping stays, days with
nothing on them, legs that land before they take off. It is a *report*, and its
issues are attached to dates, not to records.

This answers a narrower and more useful question: **which record is missing
which field, and can we just ask?** Every gap here names a record and the exact
fields to fill, so it maps straight onto a form from `chat_forms` — the same
server-owned registry the chat uses — and a submitted form goes through the
executor with no model call at all.

Two tiers, because they are not the same kind of missing:

- `blocking`  — the trip does not work without it. A flight with no departure
                time cannot be put on a timeline, and a stay with no dates
                covers no nights.
- `worth_adding` — the trip works, but you will want this when you are standing
                at the desk. Confirmation numbers, flight numbers.

Nothing here writes; it reads an assembled trip and describes the holes.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas import TripResponse

BLOCKING = "blocking"
WORTH_ADDING = "worth_adding"


@dataclass(frozen=True)
class _Wanted:
    """A field worth chasing, and how much we care."""

    name: str  # the camelCase name in chat_forms.FIELD_SPECS
    severity: str


# Deliberately short. A banner that lists nine things is a chore, not a nudge —
# and every field here has to be one the traveller can actually answer offhand.
_STAY_WANTED = (
    _Wanted("checkIn", BLOCKING),
    _Wanted("checkOut", BLOCKING),
    _Wanted("confirmationNumber", WORTH_ADDING),
)

_TRAVEL_WANTED = (
    _Wanted("departureDateTime", BLOCKING),
    _Wanted("arrivalDateTime", BLOCKING),
    _Wanted("vehicleNumber", WORTH_ADDING),
    _Wanted("confirmationNumber", WORTH_ADDING),
)

_TRIP_WANTED = (
    _Wanted("startDate", BLOCKING),
    _Wanted("endDate", BLOCKING),
    _Wanted("destinationLocationName", WORTH_ADDING),
)

# How each field reads in a banner line: "Flight to Naha — no departure time".
_PHRASING = {
    "checkIn": "no check-in date",
    "checkOut": "no check-out date",
    "departureDateTime": "no departure time",
    "arrivalDateTime": "no arrival time",
    "confirmationNumber": "no confirmation number",
    "vehicleNumber": "no flight/train number",
    "startDate": "no start date",
    "endDate": "no end date",
    "destinationLocationName": "no destination",
}


@dataclass
class TripGap:
    target: str  # "trip" | "stay" | "travel"
    record_id: str | None  # None for the trip itself
    record_label: str
    fields: list[str]
    severity: str
    message: str


def _missing(record, wanted: tuple[_Wanted, ...], attr_of) -> dict[str, list[str]]:
    """Which wanted fields this record hasn't got, grouped by severity."""
    holes: dict[str, list[str]] = {BLOCKING: [], WORTH_ADDING: []}
    for field in wanted:
        value = attr_of(record, field.name)
        if value in (None, ""):
            holes[field.severity].append(field.name)
    return holes


def _gaps_for(record, *, target: str, record_id: str | None, label: str, wanted, attr_of) -> list[TripGap]:
    """One gap per severity, so a banner can lead with what actually blocks."""
    holes = _missing(record, wanted, attr_of)
    gaps = []
    for severity in (BLOCKING, WORTH_ADDING):
        fields = holes[severity]
        if not fields:
            continue
        gaps.append(
            TripGap(
                target=target,
                record_id=record_id,
                record_label=label,
                fields=fields,
                severity=severity,
                message=f"{label} — {', '.join(_PHRASING[name] for name in fields)}",
            )
        )
    return gaps


def find_gaps(trip: TripResponse) -> list[TripGap]:
    """Every fillable hole in the trip, blocking ones first."""
    gaps: list[TripGap] = []

    gaps.extend(
        _gaps_for(
            trip,
            target="trip",
            record_id=None,
            label=trip.trip_name or "This trip",
            wanted=_TRIP_WANTED,
            attr_of=lambda rec, name: getattr(rec, _TRIP_ATTR[name], None),
        )
    )

    for stay in getattr(trip, "stays", []) or []:
        gaps.extend(
            _gaps_for(
                stay,
                target="stay",
                record_id=stay.stay_detail_id,
                label=stay.name or "Unnamed stay",
                wanted=_STAY_WANTED,
                attr_of=lambda rec, name: getattr(rec, _STAY_ATTR[name], None),
            )
        )

    for travel in getattr(trip, "travels", []) or []:
        gaps.extend(
            _gaps_for(
                travel,
                target="travel",
                record_id=travel.travel_detail_id,
                label=travel.name or "Unnamed travel leg",
                wanted=_TRAVEL_WANTED,
                attr_of=lambda rec, name: getattr(rec, _TRAVEL_ATTR[name], None),
            )
        )

    gaps.sort(key=lambda gap: 0 if gap.severity == BLOCKING else 1)
    return gaps


# The API models are snake_case internally; the form registry names fields in
# camelCase because that is what crosses the wire. These bridge the two.
_TRIP_ATTR = {
    "startDate": "start_date",
    "endDate": "end_date",
    "destinationLocationName": "destination_location_name",
}
_STAY_ATTR = {
    "checkIn": "check_in",
    "checkOut": "check_out",
    "confirmationNumber": "confirmation_number",
}
_TRAVEL_ATTR = {
    "departureDateTime": "departure_date_time",
    "arrivalDateTime": "arrival_date_time",
    "vehicleNumber": "vehicle_number",
    "confirmationNumber": "confirmation_number",
}
