"""Pydantic v2 request/response schemas.

Kept separate from SQLAlchemy models so internal columns never leak onto
the wire. camelCase aliases keep the frontend contract stable regardless
of Python style.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Annotated

from fastapi_users import schemas
from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


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


# ---- Things (example vertical slice) ----


class ThingCreate(CamelModel):
    title: str
    notes: str = ""


class ThingUpdate(CamelModel):
    title: str | None = None
    notes: str | None = None


class ThingRead(CamelModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    notes: str
    created_at: datetime
