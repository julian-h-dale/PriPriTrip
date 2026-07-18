"""Trip snapshots — the restore-point safety net.

Covers the helpers directly (capture → clobber → restore) and the three surfaces
that matter: the manual endpoints, the automatic snapshot an itinerary import
takes before its full-replace, and retention pruning.
"""

import pytest
from sqlalchemy import delete, select

from app.models import (
    LocationRecord,
    StayDetailRecord,
    TripPointRecord,
    TripSnapshotRecord,
)
from app.services import trip_snapshot
from tests.factories import (
    make_day,
    make_location,
    make_point,
    make_stay,
    make_trip,
)

pytestmark = pytest.mark.asyncio


async def _stay_names(db, trip_id) -> list[str]:
    rows = (
        await db.execute(
            select(StayDetailRecord.name).where(StayDetailRecord.trip_id == trip_id)
        )
    ).scalars().all()
    return sorted(n for n in rows)


class TestCaptureAndRestore:
    async def test_restore_brings_back_a_clobbered_subtree(self, db, user):
        trip = await make_trip(db, user, trip_name="Okinawa")
        day = await make_day(db, trip)
        stay = await make_stay(db, trip, name="Original Hyatt")
        point = await make_point(db, trip, day, title="Dinner at Giaxa")
        await make_location(db, stay=stay, name="Naha")

        snap = await trip_snapshot.snapshot_trip(
            db, trip, reason="manual", created_by=str(user.id)
        )

        # Clobber it the way an import does: hard-delete every child, rename the trip.
        for model in (TripPointRecord, StayDetailRecord):
            await db.execute(delete(model).where(model.trip_id == trip.trip_id))
        trip.trip_name = "Wrecked"
        await db.flush()
        assert await _stay_names(db, trip.trip_id) == []

        await trip_snapshot.restore_trip(db, trip, snap)

        assert await _stay_names(db, trip.trip_id) == ["Original Hyatt"]
        assert trip.trip_name == "Okinawa"
        # The point and its stay's location came back with their original ids.
        points = (
            await db.execute(
                select(TripPointRecord).where(TripPointRecord.trip_id == trip.trip_id)
            )
        ).scalars().all()
        assert [p.point_id for p in points] == [point.point_id]
        locs = (
            await db.execute(select(LocationRecord).where(LocationRecord.stay_detail_id == stay.stay_detail_id))
        ).scalars().all()
        assert [loc.name for loc in locs] == ["Naha"]

    async def test_snapshot_captures_soft_deleted_rows_too(self, db, user):
        """Fidelity: a snapshot is a point-in-time copy, not a live-rows filter."""
        trip = await make_trip(db, user)
        await make_stay(db, trip, name="Ghost", is_deleted=True)

        snap = await trip_snapshot.snapshot_trip(
            db, trip, reason="manual", created_by=str(user.id)
        )
        assert [s["name"] for s in snap.payload["stays"]] == ["Ghost"]


class TestRetention:
    async def test_only_the_newest_n_are_kept(self, db, user):
        trip = await make_trip(db, user)
        keep = trip_snapshot.MAX_SNAPSHOTS_PER_TRIP
        for _ in range(keep + 3):
            await trip_snapshot.snapshot_trip(db, trip, reason="manual", created_by=str(user.id))

        count = len(await trip_snapshot.list_snapshots(db, trip.trip_id))
        assert count == keep


class TestEndpoints:
    async def test_manual_snapshot_list_and_restore_round_trip(self, db, user, client):
        trip = await make_trip(db, user, trip_name="Kyoto")
        await make_stay(db, trip, name="Original Hyatt")

        made = await client.post(f"/trips/{trip.trip_id}/snapshots")
        assert made.status_code == 201
        snapshot_id = made.json()["snapshotId"]

        # Now wreck it through the API-independent path, then restore.
        await db.execute(delete(StayDetailRecord).where(StayDetailRecord.trip_id == trip.trip_id))
        await db.commit()

        listed = await client.get(f"/trips/{trip.trip_id}/snapshots")
        assert listed.status_code == 200
        assert any(s["reason"] == "manual" for s in listed.json())

        restored = await client.post(f"/trips/{trip.trip_id}/snapshots/{snapshot_id}/restore")
        assert restored.status_code == 200
        assert await _stay_names(db, trip.trip_id) == ["Original Hyatt"]

    async def test_restore_is_itself_snapshotted(self, db, user, client):
        trip = await make_trip(db, user)
        made = await client.post(f"/trips/{trip.trip_id}/snapshots")
        snapshot_id = made.json()["snapshotId"]

        await client.post(f"/trips/{trip.trip_id}/snapshots/{snapshot_id}/restore")

        reasons = [s["reason"] for s in (await client.get(f"/trips/{trip.trip_id}/snapshots")).json()]
        assert "restore" in reasons  # restoring captured the pre-restore state

    async def test_restoring_another_trips_snapshot_is_404(self, db, user, client):
        mine = await make_trip(db, user)
        other = await make_trip(db, user)
        snap = await trip_snapshot.snapshot_trip(db, other, reason="manual", created_by=str(user.id))
        await db.commit()

        resp = await client.post(f"/trips/{mine.trip_id}/snapshots/{snap.snapshot_id}/restore")
        assert resp.status_code == 404


class TestImportTakesASnapshot:
    async def test_import_replace_snapshots_the_prior_trip_and_is_undoable(self, db, user, client):
        trip = await make_trip(db, user, trip_name="Before")
        await make_stay(db, trip, name="Original Hyatt")

        body = {
            "tripName": "After",
            "startDate": "2026-10-30",
            "endDate": "2026-11-05",
            "stays": [{"name": "Imported Ryukyu", "stayType": "hotel"}],
            "travels": [],
            "days": [],
        }
        resp = await client.post(f"/trips/{trip.trip_id}/import", json=body)
        assert resp.status_code == 200
        # The replace happened.
        assert await _stay_names(db, trip.trip_id) == ["Imported Ryukyu"]

        # …and it left a restore point.
        snaps = (
            await db.execute(
                select(TripSnapshotRecord).where(TripSnapshotRecord.trip_id == trip.trip_id)
            )
        ).scalars().all()
        assert [s.reason for s in snaps] == ["import-replace"]

        # Undo the import.
        await client.post(f"/trips/{trip.trip_id}/snapshots/{snaps[0].snapshot_id}/restore")
        assert await _stay_names(db, trip.trip_id) == ["Original Hyatt"]
