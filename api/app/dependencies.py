"""Shared dependencies — ownership enforcement in one place.

Loads a row *and* checks it belongs to the current user, returning 404
(not 403) for missing, foreign, or deleted rows so we never leak whether
a record exists.

Shared trips have three levels: the owner (trips.user_id) can do anything;
an editor (a trip_members row with role "editor") can read and change the
trip's days, activities, stays and travel; a viewer can only read. A member
asking for more than their role allows gets 403 (they already know the trip
exists), and anyone else still gets 404.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Day, Item, Memory, Stay, Travel, Trip, TripMember, UserRecord
from app.services.versions import parse_if_match
from app.users import current_active_user


def active(model):
    """Filter helper: rows that are not soft-deleted."""
    return model.is_deleted.is_(False)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


async def _live_trip(db: AsyncSession, trip_id: uuid.UUID) -> Trip | None:
    return await db.scalar(select(Trip).where(Trip.id == trip_id, active(Trip)))


MemberRole = Literal["editor", "viewer"]
Role = Literal["owner", "editor", "viewer"]


async def _member_role(
    db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID
) -> MemberRole | None:
    """The user's role on a trip they joined, or None if they haven't."""
    role = await db.scalar(
        select(TripMember.role).where(
            TripMember.trip_id == trip_id, TripMember.user_id == user_id, active(TripMember)
        )
    )
    return "editor" if role == "editor" else "viewer" if role is not None else None


@dataclass
class ViewableTrip:
    """A live trip the current user may read, and on what footing."""

    trip: Trip
    role: Role


async def get_viewable_trip(
    trip_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> ViewableTrip:
    """A live trip the current user owns or has joined, or 404."""
    trip = await _live_trip(db, trip_id)
    if trip is None:
        raise _not_found()
    if trip.user_id == user.id:
        return ViewableTrip(trip, "owner")
    role = await _member_role(db, trip.id, user.id)
    if role is not None:
        return ViewableTrip(trip, role)
    raise _not_found()


async def get_owned_trip(
    trip_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> Trip:
    """The current user's own live trip, for what only its owner may do:
    deleting it and managing who's on it. A member gets 403; anyone else 404."""
    trip = await _live_trip(db, trip_id)
    if trip is None:
        raise _not_found()
    if trip.user_id == user.id:
        return trip
    if await _member_role(db, trip.id, user.id) is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the trip's owner can do that"
        )
    raise _not_found()


async def get_editable_trip(
    trip_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> Trip:
    """A live trip the current user may change: they own it or joined it as an
    editor. Trip children (stays, travels, days, items) are only ever changed
    through this. A viewer gets 403; anyone else 404."""
    trip = await _live_trip(db, trip_id)
    if trip is None:
        raise _not_found()
    if trip.user_id == user.id:
        return trip
    role = await _member_role(db, trip.id, user.id)
    if role == "editor":
        return trip
    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You can view this trip but not change it"
        )
    raise _not_found()


async def get_editable_item(
    item_id: uuid.UUID,
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
) -> Item:
    """A live activity on a trip the current user may change (through its live day), or 404."""
    item = await db.scalar(
        select(Item)
        .join(Day, Item.day_id == Day.id)
        .where(Item.id == item_id, Day.trip_id == trip.id, active(Item), active(Day))
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return item


async def get_editable_stay(
    stay_id: uuid.UUID,
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
) -> Stay:
    """A live stay on a trip the current user may change, or 404."""
    stay = await db.scalar(
        select(Stay).where(Stay.id == stay_id, Stay.trip_id == trip.id, active(Stay))
    )
    if stay is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return stay


async def get_editable_travel(
    travel_id: uuid.UUID,
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
) -> Travel:
    """A live travel leg on a trip the current user may change, or 404."""
    travel = await db.scalar(
        select(Travel).where(Travel.id == travel_id, Travel.trip_id == trip.id, active(Travel))
    )
    if travel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return travel


async def get_own_memory(
    memory_id: uuid.UUID,
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> Memory:
    """A live memory on a trip the user can see, written by them. Someone
    else's memory on the same trip is 403 (they can see it exists); anything
    else is 404."""
    memory = await db.scalar(
        select(Memory).where(
            Memory.id == memory_id, Memory.trip_id == viewable.trip.id, active(Memory)
        )
    )
    if memory is None:
        raise _not_found()
    if memory.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only its author can change a memory"
        )
    return memory


async def if_match_version(if_match: str | None = Header(default=None)) -> int:
    """The version a change to an entry was made from (services/versions.py):
    428 without one."""
    return parse_if_match(if_match)
