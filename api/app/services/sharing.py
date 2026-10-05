"""Sharing a trip: its owner (trips.user_id) and its members (trip_members),
each a viewer or an editor.

Two random secrets only the owner sees: the view code (trips.view_code) makes
a viewer and the edit code (trips.edit_code) an editor. The trip's id used to
be the viewer code; it's in every URL, so it now only works for people who are
already on the trip. Editors' writes go through
get_editable_trip, like the owner's.
"""

from __future__ import annotations

import datetime as dt
import secrets
import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import MemberRole, active
from app.models import Trip, TripMember, UserRecord

# 15 random bytes: 20 URL-safe characters, short enough to paste, far too many
# to guess.
_CODE_BYTES = 15


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


async def trip_for_code(db: AsyncSession, code: str) -> tuple[Trip, MemberRole] | None:
    """The live trip whose view or edit code this is, with the role it gives."""
    trip = await db.scalar(
        select(Trip).where(or_(Trip.edit_code == code, Trip.view_code == code), active(Trip))
    )
    if trip is None:
        return None
    return trip, "editor" if trip.edit_code == code else "viewer"


async def edit_code(db: AsyncSession, trip: Trip, *, renew: bool = False) -> str:
    """The trip's edit code, made on first ask. `renew` replaces it: the old
    one stops working, and anyone who already joined keeps their role."""
    if trip.edit_code is None or renew:
        trip.edit_code = secrets.token_urlsafe(_CODE_BYTES)
        await db.commit()
    return trip.edit_code


async def view_code(db: AsyncSession, trip: Trip, *, renew: bool = False) -> str:
    """The trip's view code, made and renewed like the edit code."""
    if trip.view_code is None or renew:
        trip.view_code = secrets.token_urlsafe(_CODE_BYTES)
        await db.commit()
    return trip.view_code
