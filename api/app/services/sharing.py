"""Sharing a trip: its owner (trips.user_id) and its viewers (trip_members).

Viewers can read the trip but never edit it — edits stay behind
get_owned_trip — so there are no concurrent edits to reconcile.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import active
from app.models import Trip, TripMember, UserRecord


async def membership(db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID) -> TripMember | None:
    """The user's live membership of a trip, if any."""
    return await db.scalar(
        select(TripMember).where(
            TripMember.trip_id == trip_id, TripMember.user_id == user_id, active(TripMember)
        )
    )


async def join(db: AsyncSession, trip: Trip, user_id: uuid.UUID) -> TripMember:
    """Join `trip` as a viewer. Joining again returns the existing membership."""
    existing = await membership(db, trip.id, user_id)
    if existing is not None:
        return existing
    member = TripMember(trip_id=trip.id, user_id=user_id, role="viewer")
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


async def list_members(db: AsyncSession, trip_id: uuid.UUID) -> list[tuple[TripMember, UserRecord]]:
    """The trip's live viewers with their accounts, in the order they joined."""
    result = await db.execute(
        select(TripMember, UserRecord)
        .join(UserRecord, TripMember.user_id == UserRecord.id)
        .where(TripMember.trip_id == trip_id, active(TripMember))
        .order_by(TripMember.created_at)
    )
    return list(result.tuples().all())


async def leave(db: AsyncSession, member: TripMember) -> None:
    """End a membership (soft delete — the history stays)."""
    member.is_deleted = True
    member.deleted_at = dt.datetime.now(dt.UTC)
    await db.commit()
