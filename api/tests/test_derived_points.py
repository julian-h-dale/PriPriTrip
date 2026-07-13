"""Check-in / check-out / departure / arrival points are generated, not authored.

Those four types are projections of a stay or a travel leg (app.enums
DERIVED_POINT_TYPES). detail_points.py is their single writer. Before that rule
existed, the AI importer wrote its own *and* the backend generated one from the
same leg, so a flight from ORD produced two points on the timeline:

    Departure: Flight from ORD to Houston Bush Airport   (linked, no location)
    Depart ORD                                           (location, not linked)

Neither was complete, which is also why check-in and departure points showed no
place at all. These tests pin both halves: nobody else may write one, and a
generated point carries the place it happens at.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from app.enums import LocationRole, PointType
from app.models import LocationRecord, TripPointRecord, active
from app.services.detail_points import (
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services.llm_contract import AssistantAction
from app.services.trip_action_executor import execute_action

from tests.factories import make_day, make_location, make_point, make_stay, make_travel, make_trip

pytestmark = pytest.mark.asyncio


async def _points(db, trip, point_type=None) -> list[TripPointRecord]:
    query = select(TripPointRecord).where(
        TripPointRecord.trip_id == trip.trip_id, active(TripPointRecord)
    )
    if point_type is not None:
        query = query.where(TripPointRecord.type == point_type)
    return list((await db.execute(query)).scalars().all())


async def _locations_of(db, point: TripPointRecord) -> list[LocationRecord]:
    result = await db.execute(
        select(LocationRecord)
        .where(LocationRecord.point_id == point.point_id)
        .order_by(LocationRecord.sort_order)
    )
    return list(result.scalars().all())


async def _flight_with_airports(db, trip):
    """A flight ORD -> IAH, with both airports on the leg, and its days."""
    travel = await make_travel(
        db,
        trip,
        name="Flight from ORD to Houston Bush Airport",
        departure_local=datetime(2026, 7, 25, 16, 0),
        departure_tzid="America/Chicago",
        arrival_local=datetime(2026, 7, 25, 18, 30),
        arrival_tzid="America/Chicago",
    )
    await make_location(
        db, travel=travel, role=LocationRole.ORIGIN, name="ORD",
        full_address="10000 W O'Hare Ave, Chicago, IL 60666, USA",
        google_place_id="place-ord", lat=41.9742, lng=-87.9073, sort_order=0,
    )
    await make_location(
        db, travel=travel, role=LocationRole.DESTINATION, name="Houston Bush Airport",
        full_address="2800 N Terminal Rd, Houston, TX 77032, USA",
        google_place_id="place-iah", lat=29.9902, lng=-95.3368, sort_order=1,
    )
    return travel


class TestGeneratedPointsCarryTheirPlace:
    async def test_departure_takes_the_origin_and_arrival_the_destination(self, db, user):
        trip = await make_trip(db, user)
        travel = await _flight_with_airports(db, trip)

        await sync_travel_generated_points(db, travel=travel)
        await db.flush()

        departure = (await _points(db, trip, PointType.DEPARTURE))[0]
        arrival = (await _points(db, trip, PointType.ARRIVAL))[0]

        [origin] = await _locations_of(db, departure)
        assert origin.name == "ORD"
        assert origin.role == LocationRole.ORIGIN
        # The whole point of mirroring: the map metadata comes with it.
        assert origin.google_place_id == "place-ord"
        assert (origin.lat, origin.lng) == (41.9742, -87.9073)

        [destination] = await _locations_of(db, arrival)
        assert destination.name == "Houston Bush Airport"
        assert destination.role == LocationRole.DESTINATION

    async def test_a_stay_puts_its_venue_on_both_check_in_and_check_out(self, db, user):
        trip = await make_trip(db, user)
        stay = await make_stay(
            db, trip, name="Brother's place",
            check_in_local=datetime(2026, 7, 25, 16, 0), check_in_tzid="America/Chicago",
            check_out_local=datetime(2026, 7, 28, 11, 0), check_out_tzid="America/Chicago",
        )
        await make_location(
            db, stay=stay, role=LocationRole.VENUE, name="Brother's Pizzeria",
            full_address="123 Elm St, Houston, TX 77079, USA",
        )

        await sync_stay_generated_points(db, stay=stay)
        await db.flush()

        for point_type in (PointType.CHECK_IN, PointType.CHECK_OUT):
            point = (await _points(db, trip, point_type))[0]
            [venue] = await _locations_of(db, point)
            assert venue.name == "Brother's Pizzeria"

    async def test_editing_the_leg_moves_the_point(self, db, user):
        """The mirror is rebuilt from the parent, so it cannot drift."""
        trip = await make_trip(db, user)
        travel = await _flight_with_airports(db, trip)
        await sync_travel_generated_points(db, travel=travel)
        await db.flush()

        origin = (await db.execute(
            select(LocationRecord).where(
                LocationRecord.travel_detail_id == travel.travel_detail_id,
                LocationRecord.role == LocationRole.ORIGIN,
            )
        )).scalar_one()
        origin.name = "Chicago Midway"
        await db.flush()

        await sync_travel_generated_points(db, travel=travel)
        await db.flush()

        departure = (await _points(db, trip, PointType.DEPARTURE))[0]
        [mirrored] = await _locations_of(db, departure)
        assert mirrored.name == "Chicago Midway"

    async def test_syncing_twice_does_not_pile_up_locations(self, db, user):
        trip = await make_trip(db, user)
        travel = await _flight_with_airports(db, trip)

        for _ in range(3):
            await sync_travel_generated_points(db, travel=travel)
            await db.flush()

        assert len(await _points(db, trip, PointType.DEPARTURE)) == 1
        departure = (await _points(db, trip, PointType.DEPARTURE))[0]
        assert len(await _locations_of(db, departure)) == 1


class TestNobodyElseMayWriteThem:
    async def test_the_executor_refuses_to_create_a_departure_point(self, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)

        result = await execute_action(
            db,
            trip=trip,
            action=AssistantAction.model_validate({
                "op": "create",
                "target": "point",
                "fields": {"dayId": day.day_id, "type": "departure", "title": "Depart ORD"},
            }),
        )

        assert result.status == "error"
        # The refusal has to say what to do instead, or the model just retries.
        assert "travel leg" in result.detail
        assert await _points(db, trip) == []

    async def test_the_executor_still_creates_an_activity_point(self, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)

        result = await execute_action(
            db,
            trip=trip,
            action=AssistantAction.model_validate({
                "op": "create",
                "target": "point",
                "fields": {"dayId": day.day_id, "type": "activity", "title": "Dinner at Hitoshi"},
            }),
        )

        assert result.status == "ok"
        assert [p.title for p in await _points(db, trip)] == ["Dinner at Hitoshi"]

    async def test_a_generated_point_cannot_be_edited_or_deleted(self, db, user):
        trip = await make_trip(db, user)
        travel = await _flight_with_airports(db, trip)
        await sync_travel_generated_points(db, travel=travel)
        await db.flush()
        departure = (await _points(db, trip, PointType.DEPARTURE))[0]

        edit = await execute_action(
            db, trip=trip,
            action=AssistantAction.model_validate({
                "op": "update", "target": "point", "id": departure.point_id,
                "fields": {"title": "Something else"},
            }),
        )
        assert edit.status == "error"
        assert travel.travel_detail_id in edit.detail  # points at the parent to edit

        removal = await execute_action(
            db, trip=trip,
            action=AssistantAction.model_validate({
                "op": "delete", "target": "point", "id": departure.point_id,
            }),
        )
        assert removal.status == "error"
        assert len(await _points(db, trip, PointType.DEPARTURE)) == 1

    async def test_but_the_traveller_may_still_tick_it_off(self, db, user):
        """`completed` is the user's, not the leg's — the sync leaves it alone."""
        trip = await make_trip(db, user)
        travel = await _flight_with_airports(db, trip)
        await sync_travel_generated_points(db, travel=travel)
        await db.flush()
        departure = (await _points(db, trip, PointType.DEPARTURE))[0]

        result = await execute_action(
            db, trip=trip,
            action=AssistantAction.model_validate({
                "op": "update", "target": "point", "id": departure.point_id,
                "fields": {"completed": True},
            }),
        )
        assert result.status == "ok"

        await sync_travel_generated_points(db, travel=travel)
        await db.flush()
        await db.refresh(departure)
        assert departure.completed is True


class TestTheRestApiHoldsTheSameLine:
    async def test_posting_a_check_in_point_is_rejected(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)

        resp = await client.post(
            f"/trips/{trip.trip_id}/points",
            json={
                "pointId": "11111111-1111-1111-1111-111111111111",
                "dayId": day.day_id,
                "type": "check-in",
                "title": "Check in",
            },
        )

        assert resp.status_code == 422
        assert "generated" in resp.json()["detail"]

    async def test_deleting_a_generated_point_is_rejected(self, client, db, user):
        trip = await make_trip(db, user)
        travel = await _flight_with_airports(db, trip)
        await sync_travel_generated_points(db, travel=travel)
        await db.commit()
        departure = (await _points(db, trip, PointType.DEPARTURE))[0]

        resp = await client.delete(f"/trips/{trip.trip_id}/points/{departure.point_id}")

        assert resp.status_code == 409
        assert len(await _points(db, trip, PointType.DEPARTURE)) == 1

    async def test_an_activity_point_is_still_deletable(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)
        point = await make_point(db, trip, day, type="activity", title="Dinner")

        resp = await client.delete(f"/trips/{trip.trip_id}/points/{point.point_id}")

        assert resp.status_code == 204
