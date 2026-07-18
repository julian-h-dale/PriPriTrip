"""Restore points for a trip — list, create-on-demand, and restore.

The automatic snapshots (import replace, merge apply, whole-trip delete) are
taken by *those* handlers, in their own transaction. This router is the manual
surface: see your restore points, make one before you try something risky, and
roll a trip back to one.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import TripRecord, TripSnapshotRecord, UserRecord
from app.schemas import TripResponse, TripSnapshotSummary
from app.services import trip_snapshot
from app.services.trip_state import assembled_trip

router = APIRouter(prefix="/trips/{trip_id}/snapshots", tags=["snapshots"])


@router.get("", response_model=list[TripSnapshotSummary])
async def list_trip_snapshots(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    records = await trip_snapshot.list_snapshots(db, trip.trip_id)
    return [TripSnapshotSummary.from_record(r) for r in records]


@router.post("", response_model=TripSnapshotSummary, status_code=status.HTTP_201_CREATED)
async def create_trip_snapshot(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    rec = await trip_snapshot.snapshot_trip(db, trip, reason="manual", created_by=str(user.id))
    await db.commit()
    return TripSnapshotSummary.from_record(rec)


@router.post("/{snapshot_id}/restore", response_model=TripResponse)
async def restore_trip_snapshot(
    snapshot_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    snapshot = await db.get(TripSnapshotRecord, snapshot_id)
    if snapshot is None or snapshot.trip_id != trip.trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")

    # Snapshot the current state first, so restoring is itself undoable.
    await trip_snapshot.snapshot_trip(db, trip, reason="restore", created_by=str(user.id))
    await trip_snapshot.restore_trip(db, trip, snapshot)
    await db.commit()
    await db.refresh(trip)
    return await assembled_trip(db, trip)
