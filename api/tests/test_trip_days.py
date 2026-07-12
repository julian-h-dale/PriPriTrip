"""Tests for the /trips/{trip_id}/days CRUD + restore endpoints (real DB)."""

from datetime import date

from app.models import TripDayRecord

from tests.factories import make_day, make_trip, new_id


class TestListDays:
    async def test_list(self, client, db, user):
        trip = await make_trip(db, user)
        await make_day(db, trip, title="Arrival", date="2026-10-30")
        await make_day(db, trip, title="Beach", date="2026-10-31")
        await make_day(db, trip, title="Deleted", date="2026-11-01", is_deleted=True)

        resp = await client.get(f"/trips/{trip.trip_id}/days")

        assert resp.status_code == 200
        assert [d["title"] for d in resp.json()] == ["Arrival", "Beach"]

    async def test_other_users_trip_is_404(self, client, db, other_user):
        trip = await make_trip(db, other_user)
        assert (await client.get(f"/trips/{trip.trip_id}/days")).status_code == 404


class TestCreateDay:
    async def test_create(self, client, db, user):
        trip = await make_trip(db, user)
        day_id = new_id()

        resp = await client.post(
            f"/trips/{trip.trip_id}/days",
            json={"dayId": day_id, "title": "Arrival", "date": "2026-10-30"},
        )

        assert resp.status_code == 201
        assert resp.json()["title"] == "Arrival"
        stored = await db.get(TripDayRecord, day_id)
        assert stored.trip_id == trip.trip_id

    async def test_duplicate_conflict(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)

        resp = await client.post(
            f"/trips/{trip.trip_id}/days",
            json={"dayId": day.day_id, "title": "Dup", "date": "2026-10-30"},
        )

        assert resp.status_code == 409

    async def test_missing_required_fields(self, client, db, user):
        trip = await make_trip(db, user)
        resp = await client.post(f"/trips/{trip.trip_id}/days", json={"dayId": new_id()})
        assert resp.status_code == 422


class TestPatchDay:
    async def test_patch_full_update(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip, title="Old", date="2026-10-30")

        resp = await client.patch(
            f"/trips/{trip.trip_id}/days/{day.day_id}",
            json={"title": "New", "date": "2026-11-01", "description": "Notes"},
        )

        assert resp.status_code == 200
        await db.refresh(day)
        assert (day.title, day.date, day.description) == ("New", date(2026, 11, 1), "Notes")

    async def test_patch_partial_update_leaves_other_fields_alone(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip, title="Arrival", description="Keep me")

        await client.patch(f"/trips/{trip.trip_id}/days/{day.day_id}", json={"title": "Renamed"})

        await db.refresh(day)
        assert day.title == "Renamed"
        assert day.description == "Keep me"

    async def test_put_day_is_gone(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)
        resp = await client.put(f"/trips/{trip.trip_id}/days/{day.day_id}", json={"title": "X"})
        assert resp.status_code == 405

    async def test_day_from_another_trip_is_404(self, client, db, user):
        trip = await make_trip(db, user)
        other_trip = await make_trip(db, user, trip_name="Other")
        stray = await make_day(db, other_trip)

        resp = await client.patch(f"/trips/{trip.trip_id}/days/{stray.day_id}", json={"title": "X"})

        assert resp.status_code == 404

    async def test_other_users_trip_is_404(self, client, db, other_user):
        trip = await make_trip(db, other_user)
        day = await make_day(db, trip)
        resp = await client.patch(f"/trips/{trip.trip_id}/days/{day.day_id}", json={"title": "X"})
        assert resp.status_code == 404


class TestDeleteAndRestoreDay:
    async def test_soft_delete(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)

        resp = await client.delete(f"/trips/{trip.trip_id}/days/{day.day_id}")

        assert resp.status_code == 204
        await db.refresh(day)
        assert day.is_deleted is True
        assert day.deleted_at is not None
        # Soft delete: the row survives.
        assert await db.get(TripDayRecord, day.day_id) is not None

    async def test_delete_already_deleted_is_404(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip, is_deleted=True)
        assert (await client.delete(f"/trips/{trip.trip_id}/days/{day.day_id}")).status_code == 404

    async def test_restore(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip, is_deleted=True)

        resp = await client.post(f"/trips/{trip.trip_id}/days/{day.day_id}/restore")

        assert resp.status_code == 200
        await db.refresh(day)
        assert day.is_deleted is False
        assert day.deleted_at is None

    async def test_restore_not_deleted_conflict(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)
        resp = await client.post(f"/trips/{trip.trip_id}/days/{day.day_id}/restore")
        assert resp.status_code == 409

    async def test_list_deleted(self, client, db, user):
        trip = await make_trip(db, user)
        await make_day(db, trip, title="Live")
        await make_day(db, trip, title="Gone", is_deleted=True)

        resp = await client.get(f"/trips/{trip.trip_id}/days/deleted")

        assert resp.status_code == 200
        assert [d["title"] for d in resp.json()] == ["Gone"]
