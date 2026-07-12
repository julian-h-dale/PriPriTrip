"""Tests for the /trips CRUD endpoints, against a real database."""

from app.models import TripRecord

from tests.factories import make_day, make_point, make_stay, make_travel, make_trip, new_id


class TestListTrips:
    async def test_lists_own_trips(self, client, db, user):
        await make_trip(db, user, trip_name="Okinawa", start_date="2026-10-30")
        await make_trip(db, user, trip_name="Kyoto", start_date="2026-11-20")

        resp = await client.get("/trips")

        assert resp.status_code == 200
        assert [t["tripName"] for t in resp.json()] == ["Okinawa", "Kyoto"]  # ordered by start_date

    async def test_does_not_list_other_users_trips(self, client, db, user, other_user):
        await make_trip(db, user, trip_name="Mine")
        await make_trip(db, other_user, trip_name="Theirs")

        resp = await client.get("/trips")

        assert [t["tripName"] for t in resp.json()] == ["Mine"]

    async def test_does_not_list_soft_deleted_trips(self, client, db, user):
        await make_trip(db, user, trip_name="Live")
        await make_trip(db, user, trip_name="Deleted", is_deleted=True)

        resp = await client.get("/trips")

        assert [t["tripName"] for t in resp.json()] == ["Live"]

    async def test_empty_list(self, client):
        resp = await client.get("/trips")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetTrip:
    async def test_get_assembled_trip(self, client, db, user):
        trip = await make_trip(db, user, trip_name="Okinawa")

        resp = await client.get(f"/trips/{trip.trip_id}")

        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"] == trip.trip_id
        assert body["tripName"] == "Okinawa"
        assert body["days"] == []
        assert body["stays"] == []
        assert body["travels"] == []

    async def test_assembles_days_points_stays_and_travels(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip, title="Arrival")
        stay = await make_stay(db, trip, name="Hyatt")
        await make_travel(db, trip, name="Flight")
        await make_point(db, trip, day, title="Check In", type="check-in", stay_detail_id=stay.stay_detail_id)
        await make_point(db, trip, day, title="Dinner")

        resp = await client.get(f"/trips/{trip.trip_id}")

        body = resp.json()
        assert len(body["days"]) == 1
        assert body["days"][0]["title"] == "Arrival"
        assert {p["title"] for p in body["days"][0]["points"]} == {"Check In", "Dinner"}
        assert [s["name"] for s in body["stays"]] == ["Hyatt"]
        assert [t["name"] for t in body["travels"]] == ["Flight"]

        # A point that links to a stay carries the nested detail.
        check_in = next(p for p in body["days"][0]["points"] if p["title"] == "Check In")
        assert check_in["stayDetail"]["name"] == "Hyatt"

    async def test_soft_deleted_children_are_excluded(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)
        await make_point(db, trip, day, title="Kept")
        await make_point(db, trip, day, title="Gone", is_deleted=True)
        await make_stay(db, trip, name="Gone", is_deleted=True)

        body = (await client.get(f"/trips/{trip.trip_id}")).json()

        assert [p["title"] for p in body["days"][0]["points"]] == ["Kept"]
        assert body["stays"] == []

    async def test_other_users_trip_is_404(self, client, db, other_user):
        trip = await make_trip(db, other_user)
        assert (await client.get(f"/trips/{trip.trip_id}")).status_code == 404

    async def test_soft_deleted_trip_is_404(self, client, db, user):
        trip = await make_trip(db, user, is_deleted=True)
        assert (await client.get(f"/trips/{trip.trip_id}")).status_code == 404

    async def test_missing_trip_is_404(self, client):
        assert (await client.get(f"/trips/{new_id()}")).status_code == 404


class TestUpsertTrip:
    def _body(self):
        return {
            "tripName": "Okinawa",
            "startDate": "2026-10-30",
            "endDate": "2026-11-11",
        }

    async def test_create(self, client, db, user):
        trip_id = new_id()

        resp = await client.put(f"/trips/{trip_id}", json=self._body())

        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"] == trip_id
        assert body["tripName"] == "Okinawa"
        assert body["status"] == "new"

        stored = await db.get(TripRecord, trip_id)
        assert stored.user_id == str(user.id)
        assert stored.trip_name == "Okinawa"

    async def test_update_existing(self, client, db, user):
        trip = await make_trip(db, user, trip_name="Old Name")

        resp = await client.put(f"/trips/{trip.trip_id}", json=self._body())

        assert resp.status_code == 200
        await db.refresh(trip)
        assert trip.trip_name == "Okinawa"

    async def test_body_trip_id_is_ignored_path_wins(self, client, db, user):
        trip_id = new_id()

        resp = await client.put(
            f"/trips/{trip_id}", json={**self._body(), "tripId": new_id()}
        )

        assert resp.json()["tripId"] == trip_id
        assert await db.get(TripRecord, trip_id) is not None

    async def test_update_other_users_trip_forbidden(self, client, db, other_user):
        trip = await make_trip(db, other_user)
        resp = await client.put(f"/trips/{trip.trip_id}", json=self._body())
        assert resp.status_code == 403

    async def test_upsert_revives_soft_deleted_trip(self, client, db, user):
        trip = await make_trip(db, user, is_deleted=True)

        resp = await client.put(f"/trips/{trip.trip_id}", json=self._body())

        assert resp.status_code == 200
        await db.refresh(trip)
        assert trip.is_deleted is False
        assert trip.deleted_at is None


class TestDeleteTrip:
    async def test_soft_deletes_trip_and_children(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)
        point = await make_point(db, trip, day)
        stay = await make_stay(db, trip)
        travel = await make_travel(db, trip)

        resp = await client.delete(f"/trips/{trip.trip_id}")

        assert resp.status_code == 204
        # The cascade is 4 bulk UPDATEs now, so read the rows back from the DB.
        for record in (trip, day, point, stay, travel):
            await db.refresh(record)
            assert record.is_deleted is True
            assert record.deleted_at is not None

    async def test_does_not_touch_another_trips_children(self, client, db, user):
        trip = await make_trip(db, user)
        await make_day(db, trip)
        keeper = await make_trip(db, user, trip_name="Keeper")
        keeper_day = await make_day(db, keeper)

        await client.delete(f"/trips/{trip.trip_id}")

        await db.refresh(keeper_day)
        assert keeper_day.is_deleted is False

    async def test_other_users_trip_is_404(self, client, db, other_user):
        trip = await make_trip(db, other_user)
        assert (await client.delete(f"/trips/{trip.trip_id}")).status_code == 404


class TestVerifyTrip:
    async def test_verify_runs_against_the_assembled_trip(self, client, db, user):
        trip = await make_trip(db, user)

        resp = await client.get(f"/trips/{trip.trip_id}/verify")

        assert resp.status_code == 200
        assert "issues" in resp.json()
