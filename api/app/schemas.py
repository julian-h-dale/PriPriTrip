"""Pydantic v2 request/response schemas.

Kept separate from SQLAlchemy models so internal columns never leak onto
the wire. camelCase aliases keep the frontend contract stable regardless
of Python style.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from fastapi_users import schemas
from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel

from app.trip_document import DayDoc, IanaTimezone, ItemDoc, StayDoc, TravelDoc, TripDocument


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


def _reject_tzinfo(value: time) -> time:
    # Swagger's auto-generated example for a `time` field is "08:25:57.353Z",
    # which Pydantic parses into a tz-aware time and SQLAlchemy round-trips
    # intact — then it explodes at the first comparison against a naive time.
    # Reject it at the boundary with a clear 422 instead of a 500 three calls
    # later. Silently stripping the offset is the tempting fix and the wrong
    # one — it would store 08:25 local for a client that meant 08:25 UTC.
    if value.tzinfo is not None:
        raise ValueError("wall-clock time must not carry a timezone offset")
    return value


# A wall-clock time (no offset). Use for values like "this routine ends at
# 09:00", as opposed to instants, which are UTC-aware datetimes.
WallClockTime = Annotated[time, AfterValidator(_reject_tzinfo), Field(examples=["08:30:00"])]


# ---- Users (fastapi-users) ----
#
# NOTE: fastapi-users owns these schemas and they are snake_case
# (`is_active`, `is_superuser`); the camelCase wire rule applies to domain
# endpoints only. fastapi-users constructs and validates these internally, so
# they deliberately do not extend CamelModel.


class UserRead(schemas.BaseUser[uuid.UUID]):
    name: str = ""
    timezone: str = "UTC"
    # True while they still have an admin-issued temporary password.
    must_change_password: bool = False


class UserCreate(schemas.BaseUserCreate):
    name: str = ""
    timezone: str = "UTC"


class UserUpdate(schemas.BaseUserUpdate):
    name: str | None = None
    timezone: str | None = None


# ---- Trips ----
#
# Read models are the document models plus ids, so `GET /trips/{id}` returns
# the trip in the same shape it was imported in (lessons: one schema source).
# They also carry read-only `zone` fields: the clock each time is on, computed
# by app/zones.py when the trip is read (never stored; never accepted back).
# They are built from ORM rows (`from_attributes`) and accept field names as
# well as aliases, because ORM attributes are snake_case.


_READ_CONFIG = ConfigDict(from_attributes=True, populate_by_name=True, extra="ignore")


class VersionRead(BaseModel):
    """Which version an entry is at, and who last changed it (see
    services/versions.py): the app sends `version` back in If-Match."""

    version: int = 1
    updated_at: datetime | None = None
    # Read from the row to look up the name; never sent.
    updated_by: uuid.UUID | None = Field(default=None, exclude=True)
    updated_by_name: str | None = None


class StayRead(StayDoc, VersionRead):
    model_config = _READ_CONFIG
    id: uuid.UUID
    zone: str | None = None


class TravelRead(TravelDoc, VersionRead):
    model_config = _READ_CONFIG
    id: uuid.UUID
    depart_zone: str | None = None
    arrive_zone: str | None = None
    # Computed on read (zones.leg_minutes), never stored or imported.
    duration_minutes: int | None = None


class ItemRead(ItemDoc, VersionRead):
    model_config = _READ_CONFIG
    id: uuid.UUID
    zone: str | None = None


class DayRead(DayDoc, VersionRead):
    model_config = _READ_CONFIG
    id: uuid.UUID
    items: list[ItemRead] = Field(default_factory=list)  # type: ignore[assignment]


class TripRead(TripDocument):
    model_config = ConfigDict(title="TripRead", **_READ_CONFIG)
    id: uuid.UUID
    created_at: datetime
    # The caller's footing on this trip: "owner" and "editor" may edit,
    # "viewer" may not.
    role: Literal["owner", "editor", "viewer"] | None = None
    stays: list[StayRead] = Field(default_factory=list)  # type: ignore[assignment]
    travels: list[TravelRead] = Field(default_factory=list)  # type: ignore[assignment]
    days: list[DayRead] = Field(default_factory=list)  # type: ignore[assignment]


class TripSummary(CamelModel):
    id: uuid.UUID
    name: str
    start_date: date
    end_date: date
    timezone: str
    stay_count: int
    travel_count: int
    created_at: datetime
    role: Literal["owner", "editor", "viewer"] = "owner"


class JoinTrip(CamelModel):
    """Join with the trip's view code (as a viewer) or its edit code (as an
    editor); the server tells them apart. The trip's id (`code`, or `tripId`
    from older apps) only works for someone already on the trip."""

    trip_id: uuid.UUID | None = None
    code: str | None = Field(default=None, max_length=200)


class MemberRead(CamelModel):
    user_id: uuid.UUID
    email: str
    role: Literal["editor", "viewer"]
    joined_at: datetime


class EditCode(CamelModel):
    code: str


class ViewCode(CamelModel):
    code: str


MEMORY_MAX_CHARS = 2000


def _memory_text(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("A memory needs some text")
    if len(value) > MEMORY_MAX_CHARS:
        raise ValueError(f"A memory is at most {MEMORY_MAX_CHARS} characters")
    return value


MemoryText = Annotated[str, AfterValidator(_memory_text)]


class MemoryLocation(CamelModel):
    """Where the phone was when a memory was written."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    # The phone's uncertainty radius in metres, as the browser reports it.
    accuracy: float | None = Field(default=None, ge=0)


class MemoryCreate(CamelModel):
    """A new memory, possibly written offline: the phone makes its `id` (so a
    retry can't duplicate it) and its `createdAt` (UTC, when Save was
    tapped). Both are optional for callers that don't care; the server fills
    them in."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    id: uuid.UUID | None = None
    # Must carry an offset or Z — an instant, not a wall clock.
    created_at: AwareDatetime | None = None
    text: MemoryText
    # The author's phone's zone right now (for display; ordering uses UTC).
    zone: IanaTimezone
    location: MemoryLocation | None = None
    # Shown to viewers (people following the trip) too. Private by default.
    is_public: bool = False


class MemoryUpdate(CamelModel):
    """Changing a memory's words — and optionally dropping its location (send
    `location: null`; leave it out to keep it) or changing who sees it
    (`isPublic`; leave it out to keep it). Its time and zone stay."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    text: MemoryText
    location: MemoryLocation | None = None
    is_public: bool | None = None


class PhotoRead(CamelModel):
    id: uuid.UUID
    width: int
    height: int
    # Paths under the API (no login needed: the random id is the secret).
    thumb_url: str
    display_url: str
    original_url: str


class MemoryRead(CamelModel):
    id: uuid.UUID
    text: str
    zone: str
    created_at: datetime
    updated_at: datetime | None = None
    received_at: datetime
    location: MemoryLocation | None = None
    photos: list[PhotoRead] = Field(default_factory=list)
    author_email: str
    # True when the caller wrote it — only then may they edit or delete it.
    mine: bool
    # Viewers see only public memories; the owner and editors see all.
    is_public: bool = False


# ---- backups (the Pi pulls these through /admin/backup) ----


class BackupPhoto(CamelModel):
    """One photo to back up: where it goes on the drive, and where to fetch it."""

    id: uuid.UUID
    trip_id: uuid.UUID
    trip_name: str
    memory_id: uuid.UUID
    author: str
    # The memory's moment, and the wall clock where it was written (for the
    # drive's <date>/<time>_… layout).
    taken_at: datetime
    zone: str
    local_date: date
    local_time: str  # "HHMM"
    format: str
    bytes: int
    uploaded_at: datetime
    original_url: str


class BackupPhotoPage(CamelModel):
    photos: list[BackupPhoto]
    # Pass as `after` for the next page; null on the last page.
    next: str | None = None


class BackupMemory(CamelModel):
    id: uuid.UUID
    author: str
    created_at: datetime
    zone: str
    updated_at: datetime | None = None
    text: str
    is_public: bool
    location: MemoryLocation | None = None
    photo_ids: list[uuid.UUID] = Field(default_factory=list)


class BackupJournal(CamelModel):
    """A trip's journal as it stands: every live memory, public or not."""

    trip_id: uuid.UUID
    trip_name: str
    start_date: date
    end_date: date
    memories: list[BackupMemory]


# ---- weather (GET /trips/{id}/weather) ----
# Metric, as OpenWeatherMap sends it (°C, m/s, mm); the page converts.


class WeatherNow(CamelModel):
    place: str
    zone: str  # the place's IANA zone, for showing sunrise/sunset
    observed_at: datetime
    temp: float
    feels_like: float | None = None
    condition: str | None = None
    description: str | None = None
    icon: str | None = None
    humidity: int | None = None
    wind_speed: float | None = None
    wind_gust: float | None = None
    uvi: float | None = None
    sunrise: datetime | None = None
    sunset: datetime | None = None
    fetched_at: datetime
    stale: bool = False


class WeatherDay(CamelModel):
    date: date
    place: str | None = None
    zone: str | None = None
    # "forecast": OWM's daily forecast (the next 8 days); "outlook": its
    # long-range daily summary (further out); "past": already happened;
    # "unavailable": no data could be had.
    kind: Literal["forecast", "outlook", "past", "unavailable"]
    high: float | None = None
    low: float | None = None
    feels_like: float | None = None
    condition: str | None = None
    description: str | None = None
    summary: str | None = None
    icon: str | None = None
    pop: float | None = None  # chance of rain, 0 to 1
    rain: float | None = None  # mm
    humidity: int | None = None
    clouds: int | None = None
    wind_speed: float | None = None
    wind_gust: float | None = None
    uvi: float | None = None
    sunrise: datetime | None = None
    sunset: datetime | None = None
    fetched_at: datetime | None = None
    stale: bool = False


class WeatherAlert(CamelModel):
    place: str
    event: str
    sender: str | None = None
    start: datetime
    end: datetime
    description: str | None = None


class WeatherRead(CamelModel):
    # False when no OpenWeatherMap key is set: nothing else is filled in.
    configured: bool
    # A short explanation when some or all of it couldn't be fetched.
    problem: str | None = None
    today: WeatherNow | None = None
    days: list[WeatherDay] = Field(default_factory=list)
    alerts: list[WeatherAlert] = Field(default_factory=list)


# ---- accounts: invites, resets, changing your password ----


class InviteUser(CamelModel):
    email: EmailStr
    name: str = Field(default="", max_length=100)


class TemporaryPassword(CamelModel):
    """Shown to the admin once, to send; the person must change it on sign-in."""

    temporary_password: str


class InvitedUser(TemporaryPassword):
    user: UserRead


class ChangePassword(CamelModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)


# ---- packing lists ----

PackingCategory = Literal[
    "clothes", "toiletries", "electronics", "documents", "health", "outdoors", "carry_on", "other"
]


def _packing_text(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("say what to pack")
    if len(value) > 200:
        raise ValueError("keep it under 200 characters")
    return value


PackingText = Annotated[str, AfterValidator(_packing_text)]
PackingQuantity = Annotated[int, Field(ge=1, le=99)]


class PackingItemCreate(CamelModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    category: PackingCategory
    text: PackingText
    quantity: PackingQuantity = 1


class PackingItemUpdate(CamelModel):
    """Any of: new words, how many, ticked or not, another list. Left out =
    unchanged."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    text: PackingText | None = None
    quantity: PackingQuantity | None = None
    checked: bool | None = None
    category: PackingCategory | None = None


class PackingItemRead(CamelModel):
    id: uuid.UUID
    category: PackingCategory
    text: str
    quantity: int
    checked: bool
    position: int


# ---- trip documents ----


def _document_name(value: str) -> str:
    value = " ".join(value.split())
    if not value:
        raise ValueError("give it a name")
    if len(value) > 120:
        raise ValueError("keep the name under 120 characters")
    return value


DocumentName = Annotated[str, AfterValidator(_document_name)]


class DocumentRename(CamelModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    name: DocumentName


class DocumentRead(CamelModel):
    id: uuid.UUID
    name: str
    filename: str
    content_type: str
    size: int
    updated_at: datetime
    uploaded_by_name: str | None = None
