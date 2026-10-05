"""SQLAlchemy declarative models.

Baseline conventions baked in from the first commit:
- UUID primary keys (not enumerable sequential ints)
- every domain row is owned via user_id (trip children through their trip)
- soft delete via the SoftDeleteMixin

Trip content mirrors the trip document (app/trip_document.py): bookings
(stays, travels) at trip level, activities (items) inside days. Nothing derived
is stored — the timeline computes its markers when it renders.

Trip times are *wall-clock* values: a naive DATETIME (what the ticket says).
They are deliberately not `UtcDateTime` — that type is for instants. Which
clock a time is on is worked out when read (app/zones.py: the place's
coordinates, else an explicit zone, else ...). The `*timezone` columns hold
only an explicit zone the author wrote, never a computed one.

Relationships are `lazy="raise"`: a trip is assembled with explicit
`selectinload`, and a forgotten load fails loudly instead of a lazy load
raising MissingGreenlet under asyncio.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, ClassVar

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import JSON, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.db_types import UtcDateTime


class Base(DeclarativeBase):
    pass


class SoftDeleteMixin:
    """Reversible deletes hidden from normal queries."""

    is_deleted: Mapped[bool] = mapped_column(default=False, index=True)
    deleted_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, default=None)


class VersionedMixin:
    """Optimistic concurrency for an entry several people can edit
    (services/versions.py). Every change bumps `version`; a write must say
    which version it was made from (If-Match), so a stale one is refused
    instead of silently overwriting someone else's change. `updated_at` and
    `updated_by` say who made the latest change (null until the first edit
    through the API: imported rows have no editor). `updated_by` is a user
    id with no foreign key on purpose: it's only shown as a name, and SQLite
    can't add a foreign key to a table without rebuilding it, which its
    children's foreign keys forbid once there's data."""

    version: Mapped[int] = mapped_column(default=1, server_default=text("1"))
    updated_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, default=None)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(default=None)


class UserRecord(SQLAlchemyBaseUserTableUUID, Base):
    """fastapi-users base table plus app-specific profile fields."""

    __tablename__ = "users"

    name: Mapped[str] = mapped_column(default="")
    # IANA name (e.g. "America/Chicago"), never a fixed UTC offset — an offset
    # is wrong twice a year. Anything date-shaped resolves against this, not the
    # server clock. UTC is the right template default; a real product detects
    # the browser zone at registration or asks.
    timezone: Mapped[str] = mapped_column(default="UTC")


# A wall-clock column: naive on purpose (see module docstring).
WallClockColumn = DateTime(timezone=False)


class Trip(SoftDeleteMixin, Base):
    __tablename__ = "trips"

    # The document format a trip is read back as.
    schema_version: ClassVar[int] = 1

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str]
    start_date: Mapped[dt.date]
    end_date: Mapped[dt.date]
    timezone: Mapped[str]
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, server_default=func.now())
    # The secret code that makes whoever joins with it an editor. Made on
    # first ask, renewable by the owner (services/sharing.py). The trip's id
    # is the viewer code, so this must never be shown to a member.
    edit_code: Mapped[str | None] = mapped_column(default=None)
    # The secret code that makes whoever joins with it a viewer, made and
    # renewed like the edit code. (The trip's id used to be the viewer code;
    # it's in every URL, so it now only works for people already on the trip.)
    view_code: Mapped[str | None] = mapped_column(default=None)

    __table_args__ = (
        Index("uq_trips_edit_code", "edit_code", unique=True),
        Index("uq_trips_view_code", "view_code", unique=True),
    )

    stays: Mapped[list[Stay]] = relationship(order_by="Stay.position", lazy="raise")
    travels: Mapped[list[Travel]] = relationship(order_by="Travel.position", lazy="raise")
    days: Mapped[list[Day]] = relationship(order_by="Day.date", lazy="raise")


class Stay(SoftDeleteMixin, VersionedMixin, Base):
    """One accommodation booking, spanning nights."""

    __tablename__ = "stays"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id"), index=True)
    position: Mapped[int]
    name: Mapped[str]
    type: Mapped[str]
    check_in: Mapped[dt.datetime] = mapped_column(WallClockColumn)
    check_out: Mapped[dt.datetime] = mapped_column(WallClockColumn)
    timezone: Mapped[str | None]
    location: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    room_type: Mapped[str | None]
    confirmation_number: Mapped[str | None]
    notes: Mapped[str | None]


class Travel(SoftDeleteMixin, VersionedMixin, Base):
    """One booked or scheduled leg (flight, train, ...)."""

    __tablename__ = "travels"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id"), index=True)
    position: Mapped[int]
    title: Mapped[str]
    mode: Mapped[str]
    carrier: Mapped[str | None]
    number: Mapped[str | None]
    seat: Mapped[str | None]
    from_location: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    to_location: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    depart: Mapped[dt.datetime] = mapped_column(WallClockColumn)
    arrive: Mapped[dt.datetime | None] = mapped_column(WallClockColumn)
    depart_timezone: Mapped[str | None]
    arrive_timezone: Mapped[str | None]
    confirmation_number: Mapped[str | None]
    notes: Mapped[str | None]


class Day(SoftDeleteMixin, VersionedMixin, Base):
    """One calendar date of a trip. At most one live day per date."""

    __tablename__ = "days"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id"), index=True)
    date: Mapped[dt.date]
    title: Mapped[str | None]  # optional: an untitled day is headed by its date
    summary: Mapped[str | None]

    items: Mapped[list[Item]] = relationship(order_by="Item.position", lazy="raise")

    __table_args__ = (
        # v1 grew duplicate days from three different writers; the database
        # holds the line instead. Soft-deleted days are exempt.
        Index(
            "uq_days_trip_date_live",
            "trip_id",
            "date",
            unique=True,
            sqlite_where=text("is_deleted = 0"),
            postgresql_where=text("NOT is_deleted"),
        ),
    )


class Item(SoftDeleteMixin, VersionedMixin, Base):
    """One planned activity on a day, kept in document order."""

    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    day_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("days.id"), index=True)
    position: Mapped[int]
    title: Mapped[str]
    start: Mapped[dt.datetime | None] = mapped_column(WallClockColumn)
    end: Mapped[dt.datetime | None] = mapped_column(WallClockColumn)
    timezone: Mapped[str | None]
    location: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    confirmation_number: Mapped[str | None]
    notes: Mapped[str | None]


def _utc_now() -> dt.datetime:
    """Server time, UTC, to the microsecond. SQLite's CURRENT_TIMESTAMP only
    has whole seconds, which would leave same-second rows unordered."""
    return dt.datetime.now(dt.UTC)


class TripMember(SoftDeleteMixin, Base):
    """Someone a trip is shared with. The owner is `trips.user_id` and has no
    member row, so every owner-only rule is unchanged. Every member can read
    the trip (and keep a journal on it); an "editor" can also change its
    days, activities, stays and travel. Only the owner deletes the trip or
    manages who's on it."""

    __tablename__ = "trip_members"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(default="viewer")
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, default=_utc_now)

    __table_args__ = (
        Index(
            "uq_trip_members_trip_user_live",
            "trip_id",
            "user_id",
            unique=True,
            sqlite_where=text("is_deleted = 0"),
            postgresql_where=text("NOT is_deleted"),
        ),
    )


class Memory(SoftDeleteMixin, Base):
    """One entry in a trip's journal: a point-in-time note by one traveler.

    Memories can be written offline, so the phone makes their `id` and
    `created_at` (UTC, the moment Save was tapped). `created_at` is the
    journal's only ordering key — an edit never moves a memory. The server's
    own stamp of when it arrived is `received_at` (kept for reference). `zone`
    is the IANA zone the author's phone was in: display only, so a dinner
    written in Tokyo still reads in Tokyo time when reread anywhere else.
    """

    __tablename__ = "memories"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    zone: Mapped[str]
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, default=_utc_now)
    updated_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, default=None)
    received_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, default=_utc_now)
    # Where the phone was when it was written (optional; the author can leave
    # it off). `accuracy` is the phone's own uncertainty radius, in metres.
    lat: Mapped[float | None] = mapped_column(default=None)
    lng: Mapped[float | None] = mapped_column(default=None)
    accuracy: Mapped[float | None] = mapped_column(default=None)
    # Viewers (people following along) see only public memories; the owner
    # and editors see every one. Private unless its author says otherwise.
    is_public: Mapped[bool] = mapped_column(default=False, server_default="0")

    __table_args__ = (Index("ix_memories_trip_created", "trip_id", "created_at"),)


class Photo(SoftDeleteMixin, Base):
    """A photo on a journal memory. The files (original, display copy,
    thumbnail) live in the PhotoStore, not the database; this row is what
    they are and whose. Its random UUID is also what makes its URL
    unguessable — photos are served without a login check."""

    __tablename__ = "photos"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    memory_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("memories.id"), index=True)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    # The original's file type as stored ("jpeg", "png", "webp", "heic").
    original_format: Mapped[str]
    original_bytes: Mapped[int]
    width: Mapped[int]
    height: Mapped[int]
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, default=_utc_now)
