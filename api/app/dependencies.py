"""Shared dependencies — ownership enforcement in one place.

Loads a row *and* checks it belongs to the current user, returning 404
(not 403) for missing, foreign, or deleted rows so we never leak whether
a record exists.

Shared trips have two levels: the owner (trips.user_id) can read and edit;
a member (trip_members, a viewer) can read. A member asking to edit gets 403
— they already know the trip exists — and anyone else still gets 404.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Day, Item, Memory, Stay, Travel, Trip, TripMember, UserRecord
from app.users import current_active_user


def active(model):
    """Filter helper: rows that are not soft-deleted."""
    return model.is_deleted.is_(False)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


async def _live_trip(db: AsyncSession, trip_id: uuid.UUID) -> Trip | None:
    return await db.scalar(select(Trip).where(Trip.id == trip_id, active(Trip)))


async def _is_member(db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    member = await db.scalar(
        select(TripMember.id).where(
            TripMember.trip_id == trip_id, TripMember.user_id == user_id, active(TripMember)
        )
    )
    return member is not None


@dataclass
class ViewableTrip:
    """A live trip the current user may read, and on what footing."""

    trip: Trip
    role: Literal["owner", "viewer"]


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
    if await _is_member(db, trip.id, user.id):
        return ViewableTrip(trip, "viewer")
    raise _not_found()


async def get_owned_trip(
    trip_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> Trip:
    """The current user's own live trip, for editing. Trip children (stays,
    travels, days, items) are only ever reached through this. A viewer of the
    trip gets 403; anyone else 404."""
    trip = await _live_trip(db, trip_id)
    if trip is None:
        raise _not_found()
    if trip.user_id == user.id:
        return trip
    if await _is_member(db, trip.id, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the trip's owner can change it"
        )
    raise _not_found()


async def get_owned_item(
    item_id: uuid.UUID,
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> Item:
    """A live activity on the current user's trip (through its live day), or 404."""
    item = await db.scalar(
        select(Item)
        .join(Day, Item.day_id == Day.id)
        .where(Item.id == item_id, Day.trip_id == trip.id, active(Item), active(Day))
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return item


async def get_owned_stay(
    stay_id: uuid.UUID,
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> Stay:
    """A live stay on the current user's trip, or 404."""
    stay = await db.scalar(
        select(Stay).where(Stay.id == stay_id, Stay.trip_id == trip.id, active(Stay))
    )
    if stay is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return stay


async def get_owned_travel(
    travel_id: uuid.UUID,
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> Travel:
    """A live travel leg on the current user's trip, or 404."""
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
