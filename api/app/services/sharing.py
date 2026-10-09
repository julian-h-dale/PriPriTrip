"""Sharing a trip: its owner (trips.user_id) and its members (trip_members),
each a viewer or an editor.

The owner adds people by email (an account must already exist). There are no
join codes any more (Run 26): `trips.view_code` / `trips.edit_code` are left
in the table, unused. Editors' writes go through get_editable_trip, like the
owner's.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import MemberRole, active
from app.models import Trip, TripMember, UserRecord


async def membership(db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID) -> TripMember | None:
    """The user's live membership of a trip, if any."""
    return await db.scalar(
        select(TripMember).where(
            TripMember.trip_id == trip_id, TripMember.user_id == user_id, active(TripMember)
        )
    )


class NoAccount(Exception):
    """No account has that email."""


class IsOwner(Exception):
    """That email is the trip owner's own."""


async def user_by_email(db: AsyncSession, email: str) -> UserRecord | None:
    """The active account with this email, ignoring case and spaces."""
    user = await db.scalar(
        select(UserRecord).where(func.lower(UserRecord.email) == email.strip().lower())
    )
    return user if user is not None and user.is_active else None


async def add_member(
    db: AsyncSession, trip: Trip, email: str, role: MemberRole
) -> tuple[TripMember, UserRecord, bool]:
    """Put the account with `email` on `trip` with `role`. Someone already on
    it just gets the new role. Returns the membership, the account and
    whether they were newly added."""
    user = await user_by_email(db, email)
    if user is None:
        raise NoAccount()
    if user.id == trip.user_id:
        raise IsOwner()
    existing = await membership(db, trip.id, user.id)
    if existing is not None:
        await set_role(db, existing, role)
        return existing, user, False
    member = TripMember(trip_id=trip.id, user_id=user.id, role=role)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member, user, True


async def set_role(db: AsyncSession, member: TripMember, role: MemberRole) -> None:
    if member.role != role:
        member.role = role
        await db.commit()
        await db.refresh(member)


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
