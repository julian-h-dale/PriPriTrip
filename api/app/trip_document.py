"""The trip document: one JSON file describing a whole trip.

This module is the single source of truth for the document's shape. The
published JSON Schema (`schema/trip.schema.json`, `GET /schema/trip`) is
generated from these models — never hand-edited.

Validation has two layers:

1. **Structure** — Pydantic: types, required fields, enums, no unknown fields.
   The JSON Schema expresses exactly this layer.
2. **Rules** — cross-field checks a JSON Schema cannot express (a day's date
   inside the trip, arrive after depart across timezones, ...). They are listed
   in the schema's root description so external authors can see them.

`validate_trip_document` runs both and reports every failure with a JSON path
(`days[2].items[0].start`), so a rejected upload can be fixed in one pass.

Time model (see docs/lessons_learned.md §3): trip and day dates are plain
dates; every trip time is a *wall-clock* value — what the ticket says — with no
offset, interpreted in an IANA timezone (an explicit override, otherwise the
trip's `timezone`). Instants are only computed here, to compare values that may
sit in different zones.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    ValidationError,
    WithJsonSchema,
    model_validator,
)
from pydantic.alias_generators import to_camel

SCHEMA_VERSION = 1

# ---- Field types ----

_WALL_CLOCK_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$"
_WALL_CLOCK_RE = re.compile(_WALL_CLOCK_PATTERN)


def _parse_wall_clock(value: object) -> datetime:
    # Accept a naive datetime too, so read models can be built from ORM rows.
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            raise ValueError("wall-clock time must not carry a timezone")
        return value
    if not isinstance(value, str) or not _WALL_CLOCK_RE.match(value):
        raise ValueError("must be a local date-time like 2026-05-11T15:00, with no timezone offset")
    return datetime.fromisoformat(value)


def _format_wall_clock(value: datetime) -> str:
    return value.isoformat(timespec="seconds" if value.second else "minutes")


WallClock = Annotated[
    datetime,
    BeforeValidator(_parse_wall_clock),
    PlainSerializer(_format_wall_clock, return_type=str, when_used="json"),
    WithJsonSchema(
        {
            "type": "string",
            "pattern": _WALL_CLOCK_PATTERN,
            "description": (
                "Local wall-clock date-time with no offset (what the ticket says), "
                "e.g. 2026-05-11T15:00. Interpreted in the relevant IANA timezone."
            ),
            "examples": ["2026-05-11T15:00"],
        }
    ),
]


def _check_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"unknown IANA timezone {value!r} (e.g. 'Europe/Zurich')") from None
    return value


IanaTimezone = Annotated[
    str,
    AfterValidator(_check_timezone),
    Field(
        description="IANA timezone name, e.g. Europe/Zurich. Never a UTC offset.",
        examples=["Europe/Zurich"],
    ),
]

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Markdown = Annotated[
    str,
    StringConstraints(max_length=20_000),
    Field(description="Markdown text."),
]

StayType = Literal["hotel", "hostel", "airbnb", "rental", "other"]
TravelMode = Literal["flight", "train", "bus", "ferry", "car", "other"]


# ---- Document models ----


class DocModel(BaseModel):
    """camelCase on the wire, and only camelCase: unknown keys are errors."""

    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")


class LocationDoc(DocModel):
    """A place. Coordinates are optional; when given, both are required."""

    name: Title
    address: ShortText | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    url: str | None = Field(
        default=None,
        pattern=r"^https?://",
        max_length=2000,
        description="A link for the place, e.g. a Google Maps or website URL.",
    )

    @model_validator(mode="after")
    def _coordinates_together(self) -> LocationDoc:
        if (self.lat is None) != (self.lng is None):
            raise ValueError("lat and lng must be given together")
        return self


class StayDoc(DocModel):
    """One accommodation booking, spanning nights. Lives at trip level."""

    name: Title
    type: StayType = "hotel"
    check_in: WallClock
    check_out: WallClock
    timezone: IanaTimezone | None = Field(
        default=None, description="Override; defaults to the trip's timezone."
    )
    location: LocationDoc | None = None
    confirmation_number: ShortText | None = None
    notes: Markdown | None = None


class TravelDoc(DocModel):
    """One booked or scheduled leg. Lives at trip level; the timeline places it
    by its departure. Incidental movement ("walk to the old town") is an
    activity, not a travel."""

    title: Title
    mode: TravelMode
    carrier: ShortText | None = None
    number: ShortText | None = Field(default=None, description="Flight/train number.")
    from_location: LocationDoc | None = Field(default=None, alias="from")
    to_location: LocationDoc | None = Field(default=None, alias="to")
    depart: WallClock
    arrive: WallClock | None = None
    depart_timezone: IanaTimezone | None = Field(
        default=None, description="Override; defaults to the trip's timezone."
    )
    arrive_timezone: IanaTimezone | None = Field(
        default=None, description="Override; defaults to the trip's timezone."
    )
    confirmation_number: ShortText | None = None
    notes: Markdown | None = None


class ItemDoc(DocModel):
    """One planned activity on a day. Untimed activities are fine."""

    title: Title
    start: WallClock | None = None
    end: WallClock | None = None
    timezone: IanaTimezone | None = Field(
        default=None, description="Override; defaults to the trip's timezone."
    )
    location: LocationDoc | None = None
    confirmation_number: ShortText | None = None
    notes: Markdown | None = None


class DayDoc(DocModel):
    """One calendar date. Activities keep the order they are written in."""

    # `dt.date`, not `date`: the field name would shadow the type.
    date: dt.date
    title: Title
    summary: Markdown | None = None
    items: list[ItemDoc] = Field(default_factory=list)


RULES = (
    "Rules beyond the structure below (an import that breaks any is rejected): "
    "(1) endDate is on or after startDate. "
    "(2) Every day's date is within the trip, and no date appears twice. "
    "(3) An activity's start, when given, is on its day's date; end requires start "
    "and is after it. "
    "(4) A stay's checkOut is after checkIn; checkIn is within the trip and checkOut "
    "is no later than the day after endDate. "
    "(5) A travel's depart is within the trip; arrive, when given, is after depart and "
    "no later than the day after endDate. "
    "Times in different timezones are compared as real instants. "
    "Every timezone override defaults to the trip's timezone."
)


class TripDocument(DocModel):
    """A whole trip: bookings (stays, travels) at trip level, plans in days."""

    model_config = ConfigDict(
        title="PriPriTrip trip document",
        json_schema_extra={"description": "One JSON document describing a whole trip. " + RULES},
    )

    schema_version: Literal[1] = Field(description="Document format version. Always 1.")
    name: Title
    start_date: date
    end_date: date
    timezone: IanaTimezone
    stays: list[StayDoc] = Field(default_factory=list)
    travels: list[TravelDoc] = Field(default_factory=list)
    days: list[DayDoc] = Field(default_factory=list)


# ---- Validation ----


@dataclass(frozen=True)
class DocError:
    path: str
    message: str


class TripDocumentError(Exception):
    """A rejected document, carrying every problem found."""

    def __init__(self, errors: list[DocError]) -> None:
        super().__init__(f"{len(errors)} problem(s) in trip document")
        self.errors = errors


def _path(loc: tuple[int | str, ...]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out or "(root)"


_FRIENDLY = {
    "extra_forbidden": "unknown field (check the spelling; fields are camelCase)",
    "missing": "required field is missing",
}


def _structural_errors(exc: ValidationError) -> list[DocError]:
    return [
        DocError(
            _path(err["loc"]),
            _FRIENDLY.get(err["type"], err["msg"].removeprefix("Value error, ")),
        )
        for err in exc.errors()
    ]


def _instant(value: datetime, tz: str) -> datetime:
    return value.replace(tzinfo=ZoneInfo(tz))


def check_rules(doc: TripDocument) -> list[DocError]:
    """Cross-field rules (1) to (5). Returns every violation, empty when sound."""
    errors: list[DocError] = []
    start, end = doc.start_date, doc.end_date
    last_allowed = end + timedelta(days=1)
    span = f"the trip runs {start} to {end}"

    def add(path: str, message: str) -> None:
        errors.append(DocError(path, message))

    if end < start:
        add("endDate", f"must be on or after startDate ({start})")

    seen: dict[date, int] = {}
    for i, day in enumerate(doc.days):
        p = f"days[{i}]"
        if not start <= day.date <= end:
            add(f"{p}.date", f"{day.date} is outside the trip; {span}")
        if day.date in seen:
            add(f"{p}.date", f"duplicate date {day.date}; already used by days[{seen[day.date]}]")
        else:
            seen[day.date] = i
        for j, item in enumerate(day.items):
            ip = f"{p}.items[{j}]"
            if item.start is not None and item.start.date() != day.date:
                add(f"{ip}.start", f"must be on {day.date}, the date of its day")
            if item.end is not None:
                if item.start is None:
                    add(f"{ip}.end", "end requires start")
                elif item.end <= item.start:
                    add(f"{ip}.end", "must be after start")

    for i, stay in enumerate(doc.stays):
        p = f"stays[{i}]"
        tz = stay.timezone or doc.timezone
        if not start <= stay.check_in.date() <= end:
            add(f"{p}.checkIn", f"{stay.check_in.date()} is outside the trip; {span}")
        if stay.check_out.date() > last_allowed:
            add(f"{p}.checkOut", f"must be no later than {last_allowed} (the day after the trip)")
        if _instant(stay.check_out, tz) <= _instant(stay.check_in, tz):
            add(f"{p}.checkOut", "must be after checkIn")

    for i, travel in enumerate(doc.travels):
        p = f"travels[{i}]"
        if not start <= travel.depart.date() <= end:
            add(f"{p}.depart", f"{travel.depart.date()} is outside the trip; {span}")
        if travel.arrive is not None:
            depart_at = _instant(travel.depart, travel.depart_timezone or doc.timezone)
            arrive_at = _instant(travel.arrive, travel.arrive_timezone or doc.timezone)
            if arrive_at <= depart_at:
                add(f"{p}.arrive", "must be after depart (compared across timezones)")
            if travel.arrive.date() > last_allowed:
                add(f"{p}.arrive", f"must be no later than {last_allowed} (the day after the trip)")

    return errors


def validate_trip_document(data: Any) -> TripDocument:
    """Parse and fully validate an uploaded document, or raise TripDocumentError.

    Structural errors are reported first; the cross-field rules only run on a
    structurally valid document (they need its values).
    """
    try:
        doc = TripDocument.model_validate(data)
    except ValidationError as exc:
        raise TripDocumentError(_structural_errors(exc)) from exc
    errors = check_rules(doc)
    if errors:
        raise TripDocumentError(errors)
    return doc


def trip_json_schema() -> dict[str, Any]:
    """The published JSON Schema (draft 2020-12) for the trip document."""
    schema = TripDocument.model_json_schema(by_alias=True, mode="validation")
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", **schema}
