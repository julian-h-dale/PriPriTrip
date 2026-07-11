"""Dynamic chat forms (review.md 3F-2).

Free text is a poor interface for structured data — confirmation numbers,
flight times, cabin classes. So the assistant can hand the user a small form
instead of asking them to type it all out.

The split matters: **the model does not build the form.** It names a record and
the fields it wants filled; everything else — the field's type, label, options,
and current value — comes from this registry, which is derived from the same
enums and columns the REST API already owns. The model cannot invent a field
type, an option that isn't a real enum value, or a field that doesn't exist.

Submitting a form runs through `trip_action_executor.execute_action` like any
other write, with no LLM call at all: a plain save is instant and free.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import PointType, StayType, TravelMode
from app.models import (
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
)
from app.schemas import ChatForm, ChatFormField, ChatFormOption

# Field types the frontend knows how to render.
TEXT = "text"
TEXTAREA = "textarea"
DATE = "date"
DATETIME = "datetime"
SELECT = "select"


@dataclass(frozen=True)
class FieldSpec:
    label: str
    type: str
    attr: str  # ORM attribute holding the current value
    options: tuple[str, ...] = ()
    help_text: str | None = None


def _enum_options(enum_cls) -> tuple[str, ...]:
    return tuple(member.value for member in enum_cls)


# The single source of truth for what a chat form may contain.
FIELD_SPECS: dict[str, dict[str, FieldSpec]] = {
    "trip": {
        "tripName": FieldSpec("Trip name", TEXT, "trip_name"),
        "startDate": FieldSpec("Start date", DATE, "start_date"),
        "endDate": FieldSpec("End date", DATE, "end_date"),
        "startLocationName": FieldSpec("Starting from", TEXT, "start_location_name"),
        "destinationLocationName": FieldSpec("Destination", TEXT, "destination_location_name"),
    },
    "day": {
        "title": FieldSpec("Title", TEXT, "title"),
        "date": FieldSpec("Date", DATE, "date"),
        "description": FieldSpec("Notes", TEXTAREA, "description"),
    },
    "point": {
        "title": FieldSpec("Title", TEXT, "title"),
        "type": FieldSpec("Type", SELECT, "type", _enum_options(PointType)),
        "startDateTime": FieldSpec("Starts", DATETIME, "start_date_time"),
        "endDateTime": FieldSpec("Ends", DATETIME, "end_date_time"),
        "confirmationNumber": FieldSpec("Confirmation number", TEXT, "confirmation_number"),
        "description": FieldSpec("Notes", TEXTAREA, "description"),
    },
    "stay": {
        "name": FieldSpec("Property name", TEXT, "name"),
        "stayType": FieldSpec("Type", SELECT, "stay_type", _enum_options(StayType)),
        "checkIn": FieldSpec("Check-in", DATETIME, "check_in"),
        "checkOut": FieldSpec("Check-out", DATETIME, "check_out"),
        "roomType": FieldSpec("Room type", TEXT, "room_type"),
        "confirmationNumber": FieldSpec("Confirmation number", TEXT, "confirmation_number"),
        "description": FieldSpec("Notes", TEXTAREA, "description"),
    },
    "travel": {
        "name": FieldSpec("Name", TEXT, "name"),
        "mode": FieldSpec("Mode", SELECT, "mode", _enum_options(TravelMode)),
        "operator": FieldSpec("Operator / airline", TEXT, "operator"),
        "vehicleNumber": FieldSpec("Flight / train number", TEXT, "vehicle_number"),
        "cabinClass": FieldSpec("Cabin / class", TEXT, "cabin_class"),
        "departureDateTime": FieldSpec("Departure", DATETIME, "departure_date_time"),
        "arrivalDateTime": FieldSpec("Arrival", DATETIME, "arrival_date_time"),
        "confirmationNumber": FieldSpec("Confirmation number", TEXT, "confirmation_number"),
        "description": FieldSpec("Notes", TEXTAREA, "description"),
    },
}

_RECORD_BY_TARGET = {
    "day": (TripDayRecord, "day_id"),
    "point": (TripPointRecord, "point_id"),
    "stay": (StayDetailRecord, "stay_detail_id"),
    "travel": (TravelDetailRecord, "travel_detail_id"),
}

_DEFAULT_TITLE = {
    "trip": "Trip details",
    "day": "Day details",
    "point": "Activity details",
    "stay": "Stay details",
    "travel": "Travel details",
}


class FormError(ValueError):
    """A form request the model got wrong; the text goes back as a tool result."""


@dataclass
class BuiltForm:
    form: ChatForm
    record: Any | None = None
    warnings: list[str] = field(default_factory=list)


def known_targets() -> list[str]:
    return list(FIELD_SPECS)


def known_fields(target: str) -> list[str]:
    return list(FIELD_SPECS.get(target, {}))


async def _load_record(db: AsyncSession, trip: TripRecord, target: str, record_id: str):
    if target == "trip":
        if record_id not in (None, trip.trip_id):
            raise FormError("The trip form does not take a recordId.")
        return trip

    model, _pk = _RECORD_BY_TARGET[target]
    try:
        uuid.UUID(str(record_id))
    except (AttributeError, TypeError, ValueError):
        raise FormError(
            f"{record_id!r} is not a valid {target} id. Use an id from get_trip_snapshot."
        )
    record = await db.get(model, str(record_id))
    if (
        record is None
        or record.trip_id != trip.trip_id
        or record.is_deleted
        or record.deleted_at is not None
    ):
        raise FormError(f"No {target} with id {record_id} on this trip.")
    return record


def _current_value(record, spec: FieldSpec) -> str | None:
    if record is None:
        return None
    value = getattr(record, spec.attr, None)
    if value is None:
        return None
    return str(value)


async def build_form(
    db: AsyncSession,
    *,
    trip: TripRecord,
    target: str,
    record_id: str | None,
    field_names: list[str],
    title: str | None = None,
    submit_label: str | None = None,
) -> BuiltForm:
    """Assemble a form the model asked for. Raises FormError on bad requests."""
    if target not in FIELD_SPECS:
        raise FormError(f"Unknown form target {target!r}. Valid targets: {', '.join(known_targets())}.")

    specs = FIELD_SPECS[target]
    if not field_names:
        raise FormError(f"Ask for at least one field. Available for {target}: {', '.join(specs)}.")

    unknown = [name for name in field_names if name not in specs]
    if unknown:
        raise FormError(
            f"Unknown {target} field(s): {', '.join(unknown)}. "
            f"Available: {', '.join(specs)}."
        )

    record = None
    if target == "trip":
        record = trip
    elif record_id:
        record = await _load_record(db, trip, target, record_id)
    # No record_id on a non-trip target means the form creates a new record.

    fields = []
    for name in dict.fromkeys(field_names):  # de-dupe, keep order
        spec = specs[name]
        fields.append(
            ChatFormField(
                name=name,
                label=spec.label,
                type=spec.type,
                value=_current_value(record, spec),
                options=[ChatFormOption(value=opt, label=opt.replace("_", " ").title()) for opt in spec.options],
                helpText=spec.help_text,
            )
        )

    return BuiltForm(
        form=ChatForm(
            formId=str(uuid.uuid4()),
            title=title or _DEFAULT_TITLE[target],
            submitLabel=submit_label or "Save",
            target=target,
            recordId=None if target == "trip" else record_id,
            fields=fields,
        ),
        record=record,
    )


def validate_submission(target: str, values: dict[str, Any]) -> dict[str, Any]:
    """Filter a submitted payload down to fields this target really has.

    The form came from the server, but the submission arrives from the client,
    so it is re-checked here rather than trusted.
    """
    if target not in FIELD_SPECS:
        raise FormError(f"Unknown form target {target!r}.")

    specs = FIELD_SPECS[target]
    unknown = [name for name in values if name not in specs]
    if unknown:
        raise FormError(f"Unknown {target} field(s): {', '.join(sorted(unknown))}.")

    cleaned: dict[str, Any] = {}
    for name, value in values.items():
        spec = specs[name]
        if isinstance(value, str):
            value = value.strip()
        if value in ("", None):
            continue  # a blank field means "leave it alone"
        if spec.options and str(value) not in spec.options:
            raise FormError(
                f"{value!r} is not a valid {spec.label.lower()}. Options: {', '.join(spec.options)}."
            )
        cleaned[name] = value
    if not cleaned:
        raise FormError("The form was submitted with no values filled in.")
    return cleaned


def describe_submission(target: str, values: dict[str, Any]) -> str:
    """Human-readable echo of what the user filled in, for the transcript."""
    specs = FIELD_SPECS[target]
    parts = [f"{specs[name].label}: {value}" for name, value in values.items() if name in specs]
    return "; ".join(parts)
