"""Shared dependencies — ownership enforcement in one place.

Loads a row *and* checks it belongs to the current user, returning 404
(not 403) for missing, foreign, or deleted rows so we never leak whether
a record exists.
"""

from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Trip, UserRecord
from app.users import current_active_user


def active(model):
    """Filter helper: rows that are not soft-deleted."""
    return model.is_deleted.is_(False)


async def get_owned_trip(
    trip_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> Trip:
    """The current user's live trip, or 404. Trip children (stays, travels,
    days, items) are only ever reached through this."""
    result = await db.execute(
        select(Trip).where(
            Trip.id == trip_id,
            Trip.user_id == user.id,
            active(Trip),
        )
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return trip
