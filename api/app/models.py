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
from sqlalchemy import JSON, DateTime, ForeignKey, Index, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.db_types import UtcDateTime


class Base(DeclarativeBase):
    pass


class SoftDeleteMixin:
    """Reversible deletes hidden from normal queries."""

    is_deleted: Mapped[bool] = mapped_column(default=False, index=True)
    deleted_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, default=None)


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

    stays: Mapped[list[Stay]] = relationship(order_by="Stay.position", lazy="raise")
    travels: Mapped[list[Travel]] = relationship(order_by="Travel.position", lazy="raise")
    days: Mapped[list[Day]] = relationship(order_by="Day.date", lazy="raise")


class Stay(SoftDeleteMixin, Base):
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


class Travel(SoftDeleteMixin, Base):
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


class Day(SoftDeleteMixin, Base):
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


class Item(SoftDeleteMixin, Base):
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
