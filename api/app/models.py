"""SQLAlchemy declarative models.

Baseline conventions baked in from the first commit:
- UUID primary keys (not enumerable sequential ints)
- every domain row is owned via user_id
- soft delete via the SoftDeleteMixin
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import ForeignKey, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.db_types import UtcDateTime


class Base(DeclarativeBase):
    pass


class SoftDeleteMixin:
    """Reversible deletes hidden from normal queries."""

    is_deleted: Mapped[bool] = mapped_column(default=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, default=None)


class UserRecord(SQLAlchemyBaseUserTableUUID, Base):
    """fastapi-users base table plus app-specific profile fields."""

    __tablename__ = "users"

    name: Mapped[str] = mapped_column(default="")
    # IANA name (e.g. "America/Chicago"), never a fixed UTC offset — an offset
    # is wrong twice a year. Anything date-shaped resolves against this, not the
    # server clock. UTC is the right template default; a real product detects
    # the browser zone at registration or asks.
    timezone: Mapped[str] = mapped_column(default="UTC")

    things: Mapped[list[Thing]] = relationship(back_populates="owner")


class Thing(SoftDeleteMixin, Base):
    """Example owned domain entity — the vertical-slice reference.

    Replace/extend with real domain models; keep the ownership +
    soft-delete + UUID shape.
    """

    __tablename__ = "things"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    title: Mapped[str]
    notes: Mapped[str] = mapped_column(default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, server_default=func.now())

    owner: Mapped[UserRecord] = relationship(back_populates="things")
