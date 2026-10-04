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
from typing import Annotated, Any, Literal, TypeVar
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

from app.zones import arrive_zone, depart_zone, stay_zone

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

_ZONE_FALLBACK = (
    "Only used when the place has no coordinates. A time's zone comes from where "
    "it happens (its place), else this field, else the trip's timezone."
)

StayType = Literal["hotel", "hostel", "airbnb", "rental", "other"]
TravelMode = Literal["flight", "train", "bus", "ferry", "boat", "car", "other"]


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
        description="A link for the place, e.g. a website.",
    )
    place_id: ShortText | None = Field(
        default=None, description="Google place id, for exact map links."
    )
    city: ShortText | None = Field(
        default=None, description="The city or town it's in, for the timeline's day rows."
    )
    img_ref: str | None = Field(
        default=None,
        pattern=r"^https?://",
        max_length=2000,
        description="The first photo Google Places returned when the place was picked.",
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
    timezone: IanaTimezone | None = Field(default=None, description=_ZONE_FALLBACK)
    location: LocationDoc | None = Field(
        default=None, description="Where you stay; its coordinates set the stay's clock."
    )
    room_type: ShortText | None = None
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
    seat: ShortText | None = None
    from_location: LocationDoc = Field(
        alias="from", description="Where the leg leaves from; sets the departure's clock."
    )
    to_location: LocationDoc | None = Field(
        default=None, alias="to", description="Where it lands; sets the arrival's clock."
    )
    depart: WallClock
    arrive: WallClock | None = None
    depart_timezone: IanaTimezone | None = Field(default=None, description=_ZONE_FALLBACK)
    arrive_timezone: IanaTimezone | None = Field(default=None, description=_ZONE_FALLBACK)
    confirmation_number: ShortText | None = None
    notes: Markdown | None = None


class ItemDoc(DocModel):
    """One planned activity on a day. Untimed activities are fine."""

    title: Title
    start: WallClock | None = None
    end: WallClock | None = None
    timezone: IanaTimezone | None = Field(
        default=None,
        description=(
            "Only used when the activity's place has no coordinates; otherwise its "
            "zone comes from its place, else that night's stay, else the trip."
        ),
    )
    location: LocationDoc | None = None
    confirmation_number: ShortText | None = None
    notes: Markdown | None = None


class DayDoc(DocModel):
    """One calendar date. Activities keep the order they are written in."""

    # `dt.date`, not `date`: the field name would shadow the type.
    date: dt.date
    title: Title | None = Field(
        default=None, description="Optional; an untitled day is headed by its date."
    )
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
    "Users write wall-clock times; each time's zone comes from its place's "
    "coordinates, else an explicit timezone field, else (activities) that night's "
    "stay, else the trip's timezone. Times in different zones are compared as real "
    "instants."
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


def check_item(item: ItemDoc, day_date: dt.date, *, prefix: str = "") -> list[DocError]:
    """Rule (3) for one activity. Shared by import and editing, so both reject
    the same activity the same way."""
    errors: list[DocError] = []
    if item.start is not None and item.start.date() != day_date:
        errors.append(DocError(f"{prefix}start", f"must be on {day_date}, the date of its day"))
    if item.end is not None:
        if item.start is None:
            errors.append(DocError(f"{prefix}end", "end requires start"))
        elif item.end <= item.start:
            errors.append(DocError(f"{prefix}end", "must be after start"))
    return errors


@dataclass(frozen=True)
class TripFrame:
    """What a booking is checked against: the trip's dates and default clock."""

    start: dt.date
    end: dt.date
    timezone: str

    @property
    def span(self) -> str:
        return f"the trip runs {self.start} to {self.end}"

    @property
    def last_allowed(self) -> dt.date:
        return self.end + timedelta(days=1)


def check_stay(stay: StayDoc, frame: TripFrame, *, prefix: str = "") -> list[DocError]:
    """Rule (4) for one stay, on the stay's own clock. Shared by import and editing."""
    errors: list[DocError] = []
    zone = stay_zone(stay, frame.timezone)
    if not frame.start <= stay.check_in.date() <= frame.end:
        errors.append(
            DocError(
                f"{prefix}checkIn", f"{stay.check_in.date()} is outside the trip; {frame.span}"
            )
        )
    if stay.check_out.date() > frame.last_allowed:
        errors.append(
            DocError(
                f"{prefix}checkOut",
                f"must be no later than {frame.last_allowed} (the day after the trip)",
            )
        )
    if _instant(stay.check_out, zone) <= _instant(stay.check_in, zone):
        errors.append(DocError(f"{prefix}checkOut", "must be after checkIn"))
    return errors


def check_travel(travel: TravelDoc, frame: TripFrame, *, prefix: str = "") -> list[DocError]:
    """Rule (5) for one leg: each end on its own place's clock. Shared by import and editing."""
    errors: list[DocError] = []
    if not frame.start <= travel.depart.date() <= frame.end:
        errors.append(
            DocError(f"{prefix}depart", f"{travel.depart.date()} is outside the trip; {frame.span}")
        )
    if travel.arrive is not None:
        depart_at = _instant(travel.depart, depart_zone(travel, frame.timezone))
        arrive_at = _instant(travel.arrive, arrive_zone(travel, frame.timezone))
        if arrive_at <= depart_at:
            errors.append(
                DocError(f"{prefix}arrive", "must be after depart (each in its own place's time)")
            )
        if travel.arrive.date() > frame.last_allowed:
            errors.append(
                DocError(
                    f"{prefix}arrive",
                    f"must be no later than {frame.last_allowed} (the day after the trip)",
                )
            )
    return errors


def check_rules(doc: TripDocument) -> list[DocError]:
    """Cross-field rules (1) to (5). Returns every violation, empty when sound."""
    errors: list[DocError] = []
    start, end = doc.start_date, doc.end_date
    span = f"the trip runs {start} to {end}"

    def add(path: str, message: str) -> None:
        errors.append(DocError(path, message))

    if end < start:
        # Every range check below would fail too; report the one real problem.
        add("endDate", f"must be on or after startDate ({start})")
        return errors

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
            errors.extend(check_item(item, day.date, prefix=f"{p}.items[{j}]."))

    frame = TripFrame(start, end, doc.timezone)
    for i, stay in enumerate(doc.stays):
        errors.extend(check_stay(stay, frame, prefix=f"stays[{i}]."))
    for i, travel in enumerate(doc.travels):
        errors.extend(check_travel(travel, frame, prefix=f"travels[{i}]."))

    return errors


M = TypeVar("M", bound=BaseModel)


def parse_part(model: type[M], data: Any) -> M:
    """Structural validation of any document model, errors with paths."""
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise TripDocumentError(_structural_errors(exc)) from exc


def validate_trip_document(data: Any) -> TripDocument:
    """Parse and fully validate an uploaded document, or raise TripDocumentError.

    Structural errors are reported first; the cross-field rules only run on a
    structurally valid document (they need its values).
    """
    doc = parse_part(TripDocument, data)
    errors = check_rules(doc)
    if errors:
        raise TripDocumentError(errors)
    return doc


# ---- Editing ----
#
# Edits use the same models and rules as an import, so an activity the importer
# rejects is rejected by the editor too, with the same path and message.


class ItemWrite(ItemDoc):
    """A whole activity plus the date it belongs on (create, or full replace)."""

    date: dt.date


class DayWrite(DocModel):
    """A day's own fields: everything except its date and activities."""

    title: Title | None = None
    summary: Markdown | None = None


def _outside_trip(day_date: dt.date, start: dt.date, end: dt.date) -> DocError | None:
    if start <= day_date <= end:
        return None
    return DocError("date", f"{day_date} is outside the trip; the trip runs {start} to {end}")


def validate_item_write(data: Any, start: dt.date, end: dt.date) -> ItemWrite:
    """Parse and fully validate an edited activity, or raise TripDocumentError."""
    write = parse_part(ItemWrite, data)
    errors = [e for e in [_outside_trip(write.date, start, end)] if e]
    errors += check_item(write, write.date)
    if errors:
        raise TripDocumentError(errors)
    return write


def validate_stay_write(data: Any, frame: TripFrame) -> StayDoc:
    """Parse and fully validate an edited stay, or raise TripDocumentError."""
    stay = parse_part(StayDoc, data)
    errors = check_stay(stay, frame)
    if errors:
        raise TripDocumentError(errors)
    return stay


def validate_travel_write(data: Any, frame: TripFrame) -> TravelDoc:
    """Parse and fully validate an edited travel leg, or raise TripDocumentError."""
    travel = parse_part(TravelDoc, data)
    errors = check_travel(travel, frame)
    if errors:
        raise TripDocumentError(errors)
    return travel


def validate_day_date(day_date: dt.date, start: dt.date, end: dt.date) -> None:
    error = _outside_trip(day_date, start, end)
    if error:
        raise TripDocumentError([error])


def trip_json_schema() -> dict[str, Any]:
    """The published JSON Schema (draft 2020-12) for the trip document."""
    schema = TripDocument.model_json_schema(by_alias=True, mode="validation")
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", **schema}
