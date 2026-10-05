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
from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field
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
    """Join with the trip's id (as a viewer) or its edit code (as an editor).
    `code` takes either; `tripId` is what older apps send."""

    trip_id: uuid.UUID | None = None
    code: str | None = Field(default=None, max_length=200)


class MemberRead(CamelModel):
    user_id: uuid.UUID
    email: str
    role: Literal["editor", "viewer"]
    joined_at: datetime


class EditCode(CamelModel):
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


class MemoryUpdate(CamelModel):
    """Changing a memory's words — and optionally dropping its location (send
    `location: null`; leave it out to keep it). Its time and zone stay."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    text: MemoryText
    location: MemoryLocation | None = None


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
