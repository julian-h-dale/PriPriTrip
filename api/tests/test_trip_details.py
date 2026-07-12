"""Tests for the first-class travel/stay detail CRUD endpoints (real DB).

These now exercise the batch location loading added in review.md 1C-3, so a
detail's locations really are matched to their owner rather than every row
being handed back by a fake session.
"""

from app.models import LocationRecord, StayDetailRecord, TravelDetailRecord

from tests.factories import make_location, make_stay, make_travel, make_trip, new_id


class TestTravelDetails:
    async def test_list_with_locations_grouped_by_owner(self, client, db, user):
        trip = await make_trip(db, user)
        first = await make_travel(db, trip, name="Flight BA123", mode="flight")
        second = await make_travel(db, trip, name="Train to Bern", mode="train")
        await make_location(db, travel=first, role="origin", name="LHR")
        await make_location(db, travel=first, role="destination", name="Naha")
        await make_location(db, travel=second, role="origin", name="Zurich")
        await make_travel(db, trip, name="Deleted", is_deleted=True)

        resp = await client.get(f"/trips/{trip.trip_id}/travel-details")

        assert resp.status_code == 200
        body = resp.json()
        by_name = {d["name"]: d for d in body}
        assert set(by_name) == {"Flight BA123", "Train to Bern"}
        # The batch loader must not spill one leg's locations onto another.
        assert {loc["name"] for loc in by_name["Flight BA123"]["locations"]} == {"LHR", "Naha"}
        assert {loc["name"] for loc in by_name["Train to Bern"]["locations"]} == {"Zurich"}

    async def test_get_one(self, client, db, user):
        trip = await make_trip(db, user)
        travel = await make_travel(db, trip)

        resp = await client.get(f"/trips/{trip.trip_id}/travel-details/{travel.travel_detail_id}")

        assert resp.status_code == 200
        assert resp.json()["travelDetailId"] == travel.travel_detail_id

    async def test_get_one_from_another_trip_is_404(self, client, db, user):
        trip = await make_trip(db, user)
        other_trip = await make_trip(db, user, trip_name="Other")
        stray = await make_travel(db, other_trip)

        resp = await client.get(f"/trips/{trip.trip_id}/travel-details/{stray.travel_detail_id}")

        assert resp.status_code == 404

    async def test_create(self, client, db, user):
        trip = await make_trip(db, user)

        resp = await client.post(
            f"/trips/{trip.trip_id}/travel-details",
            json={"name": "Train to Bern", "mode": "train", "departureDateTime": "2026-01-01T09:00"},
        )

        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Train to Bern"
        assert body["tripId"] == trip.trip_id
        stored = await db.get(TravelDetailRecord, body["travelDetailId"])
        assert stored.mode == "train"

    async def test_patch_only_touches_the_given_fields(self, client, db, user):
        trip = await make_trip(db, user)
        travel = await make_travel(db, trip, name="Flight BA123", operator="BA", mode="flight")

        resp = await client.patch(
            f"/trips/{trip.trip_id}/travel-details/{travel.travel_detail_id}",
            json={"cabinClass": "first", "name": "Renamed"},
        )

        assert resp.status_code == 200
        await db.refresh(travel)
        assert travel.cabin_class == "first"
        assert travel.name == "Renamed"
        assert travel.operator == "BA"  # untouched

    async def test_delete_is_a_soft_delete(self, client, db, user):
        trip = await make_trip(db, user)
        travel = await make_travel(db, trip)

        resp = await client.delete(f"/trips/{trip.trip_id}/travel-details/{travel.travel_detail_id}")

        assert resp.status_code == 204
        await db.refresh(travel)
        assert travel.is_deleted is True
        assert travel.deleted_at is not None

    async def test_trip_not_owned_404(self, client, db, other_user):
        trip = await make_trip(db, other_user)
        assert (await client.get(f"/trips/{trip.trip_id}/travel-details")).status_code == 404


class TestStayDetails:
    async def test_list_with_locations_grouped_by_owner(self, client, db, user):
        trip = await make_trip(db, user)
        first = await make_stay(db, trip, name="Hotel Test")
        second = await make_stay(db, trip, name="Ryokan")
        await make_location(db, stay=first, name="Naha")
        await make_location(db, stay=second, name="Kyoto")

        resp = await client.get(f"/trips/{trip.trip_id}/stay-details")

        assert resp.status_code == 200
        by_name = {d["name"]: d for d in resp.json()}
        assert [loc["name"] for loc in by_name["Hotel Test"]["locations"]] == ["Naha"]
        assert [loc["name"] for loc in by_name["Ryokan"]["locations"]] == ["Kyoto"]

    async def test_create(self, client, db, user):
        trip = await make_trip(db, user)

        resp = await client.post(
            f"/trips/{trip.trip_id}/stay-details",
            json={
                "name": "Hyatt Regency Naha",
                "stayType": "hotel",
                "checkIn": "2026-10-30T15:00",
                "checkOut": "2026-11-05T11:00",
            },
        )

        assert resp.status_code == 201
        body = resp.json()
        stored = await db.get(StayDetailRecord, body["stayDetailId"])
        assert stored.name == "Hyatt Regency Naha"
        assert stored.stay_type == "hotel"

    async def test_patch(self, client, db, user):
        trip = await make_trip(db, user)
        stay = await make_stay(db, trip, room_type="double", confirmation_number="XYZ")

        resp = await client.patch(
            f"/trips/{trip.trip_id}/stay-details/{stay.stay_detail_id}",
            json={"roomType": "suite"},
        )

        assert resp.status_code == 200
        await db.refresh(stay)
        assert stay.room_type == "suite"
        assert stay.confirmation_number == "XYZ"  # untouched

    async def test_patch_locations_replaces_them(self, client, db, user):
        trip = await make_trip(db, user)
        stay = await make_stay(db, trip)
        await make_location(db, stay=stay, name="Old Address")

        resp = await client.patch(
            f"/trips/{trip.trip_id}/stay-details/{stay.stay_detail_id}",
            json={
                "locations": [
                    {"locationId": new_id(), "role": "venue", "name": "New Address"}
                ]
            },
        )

        assert resp.status_code == 200
        assert [loc["name"] for loc in resp.json()["locations"]] == ["New Address"]

        # The old row is really gone from the table, not just filtered out.
        rows = (
            await db.execute(
                LocationRecord.__table__.select().where(
                    LocationRecord.stay_detail_id == stay.stay_detail_id
                )
            )
        ).all()
        assert [row.name for row in rows] == ["New Address"]

    async def test_delete_is_a_soft_delete(self, client, db, user):
        trip = await make_trip(db, user)
        stay = await make_stay(db, trip)

        resp = await client.delete(f"/trips/{trip.trip_id}/stay-details/{stay.stay_detail_id}")

        assert resp.status_code == 204
        await db.refresh(stay)
        assert stay.is_deleted is True
