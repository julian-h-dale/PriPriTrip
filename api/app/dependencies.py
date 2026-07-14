"""Shared FastAPI dependencies (review.md 1C-2).

`get_owned_trip` is the single trip-ownership check: it 404s when the trip is
missing, belongs to another user, or is soft-deleted. Routers whose prefix
contains {trip_id} take `trip: TripRecord = Depends(get_owned_trip)` in each
handler so they get the verified trip object for free.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import TripRecord, UserRecord


def is_active_trip(trip: TripRecord | None, user: UserRecord) -> bool:
    return (
        trip is not None
        and trip.user_id == str(user.id)
        and not bool(trip.is_deleted)
        and trip.deleted_at is None
    )


async def require_owned_trip(db: AsyncSession, trip_id: str, user: UserRecord) -> TripRecord:
    """Plain helper for handlers whose trip id comes from the body, not the path."""
    trip = await db.get(TripRecord, trip_id)
    # `trip is None` is checked here rather than left to is_active_trip so that
    # the return below is a TripRecord, not a TripRecord | None. is_active_trip
    # cannot be a TypeIs: it also returns False for a live-but-soft-deleted trip.
    if trip is None or not is_active_trip(trip, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


async def get_owned_trip(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
) -> TripRecord:
    return await require_owned_trip(db, trip_id, user)
