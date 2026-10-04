"""Sharing a trip: its owner (trips.user_id) and its members (trip_members),
each a viewer or an editor.

The trip's id is the viewer code; its edit code (trips.edit_code, a random
secret only the owner sees) makes an editor. Editors' writes go through
get_editable_trip, like the owner's.
"""

from __future__ import annotations

import datetime as dt
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import MemberRole, active
from app.models import Trip, TripMember, UserRecord

# 15 random bytes: 20 URL-safe characters, short enough to paste, far too many
# to guess.
_EDIT_CODE_BYTES = 15


async def membership(db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID) -> TripMember | None:
    """The user's live membership of a trip, if any."""
    return await db.scalar(
        select(TripMember).where(
            TripMember.trip_id == trip_id, TripMember.user_id == user_id, active(TripMember)
        )
    )


async def join(db: AsyncSession, trip: Trip, user_id: uuid.UUID, role: MemberRole) -> TripMember:
    """Join `trip` with `role`. Joining again with the other code changes the
    role to that code's; with the same code it changes nothing."""
    existing = await membership(db, trip.id, user_id)
    if existing is not None:
        if existing.role != role:
            existing.role = role
            await db.commit()
        return existing
    member = TripMember(trip_id=trip.id, user_id=user_id, role=role)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


async def list_members(db: AsyncSession, trip_id: uuid.UUID) -> list[tuple[TripMember, UserRecord]]:
    """The trip's live members with their accounts, in the order they joined."""
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


async def trip_for_edit_code(db: AsyncSession, code: str) -> Trip | None:
    """The live trip whose edit code this is, if any."""
    return await db.scalar(select(Trip).where(Trip.edit_code == code, active(Trip)))


async def edit_code(db: AsyncSession, trip: Trip, *, renew: bool = False) -> str:
    """The trip's edit code, made on first ask. `renew` replaces it: the old
    one stops working, and anyone who already joined keeps their role."""
    if trip.edit_code is None or renew:
        trip.edit_code = secrets.token_urlsafe(_EDIT_CODE_BYTES)
        await db.commit()
    return trip.edit_code
