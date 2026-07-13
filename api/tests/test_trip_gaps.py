"""Proactive gap-filling: what's missing, and filling it without a model call.

The premise of the feature is that recording a plan must not be the expensive
part of using the app. So the path from "3 things missing" to a saved value has
to be a form the server already built and an executor write — no OpenAI call
anywhere on it. `test_filling_a_gap_costs_no_model_call` is the one that pins
that; the rest pin what counts as a gap.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from app.services.trip_gaps import BLOCKING, WORTH_ADDING, find_gaps
from app.services.trip_state import assembled_trip

from tests.factories import as_date, make_stay, make_travel, make_trip

pytestmark = pytest.mark.asyncio


def _by_target(gaps, target, severity=None):
    return [
        g for g in gaps
        if g.target == target and (severity is None or g.severity == severity)
    ]


class TestFindGaps:
    async def test_a_flight_with_no_times_is_blocking(self, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"))
        await make_travel(db, trip, name="Flight to Naha")

        gaps = find_gaps(await assembled_trip(db, trip))

        [blocking] = _by_target(gaps, "travel", BLOCKING)
        assert blocking.fields == ["departureDateTime", "arrivalDateTime"]
        assert blocking.record_label == "Flight to Naha"
        assert "no departure time" in blocking.message

    async def test_a_confirmation_number_is_only_worth_adding(self, db, user):
        """A flight with times works. It is just nicer with the booking ref."""
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"))
        await make_travel(
            db, trip, name="Flight to Naha",
            departure_local=datetime(2026, 10, 30, 9, 0), departure_tzid="Asia/Tokyo",
            arrival_local=datetime(2026, 10, 30, 12, 0), arrival_tzid="Asia/Tokyo",
        )

        gaps = find_gaps(await assembled_trip(db, trip))

        assert _by_target(gaps, "travel", BLOCKING) == []
        [nice] = _by_target(gaps, "travel", WORTH_ADDING)
        assert set(nice.fields) == {"vehicleNumber", "confirmationNumber"}

    async def test_a_complete_record_produces_no_gap(self, db, user):
        trip = await make_trip(
            db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"),
            destination_location_name="Okinawa",
        )
        await make_stay(
            db, trip, name="Hyatt",
            check_in_local=datetime(2026, 10, 30, 16, 0), check_in_tzid="Asia/Tokyo",
            check_out_local=datetime(2026, 11, 5, 11, 0), check_out_tzid="Asia/Tokyo",
            confirmation_number="ABC123",
        )

        gaps = find_gaps(await assembled_trip(db, trip))

        assert _by_target(gaps, "stay") == []
        assert _by_target(gaps, "trip") == []

    async def test_blocking_gaps_come_first(self, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"))
        await make_stay(db, trip, name="Hyatt")  # no dates: blocking

        gaps = find_gaps(await assembled_trip(db, trip))

        assert gaps[0].severity == BLOCKING
        assert [g.severity for g in gaps] == sorted(
            [g.severity for g in gaps], key=lambda s: 0 if s == BLOCKING else 1
        )


class TestGapsEndpoint:
    async def test_each_gap_arrives_with_a_form_ready_to_fill(self, client, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"))
        travel = await make_travel(db, trip, name="Flight to Naha")
        await db.commit()

        resp = await client.get(f"/trips/{trip.trip_id}/gaps")

        assert resp.status_code == 200
        body = resp.json()
        assert body["blockingCount"] >= 1

        blocking = next(g for g in body["gaps"] if g["severity"] == "blocking" and g["target"] == "travel")
        assert blocking["recordId"] == travel.travel_detail_id
        # The form is server-built: the client never decides the field types.
        form = blocking["form"]
        assert [f["name"] for f in form["fields"]] == ["departureDateTime", "arrivalDateTime"]
        assert all(f["type"] == "datetime" for f in form["fields"])

    async def test_filling_a_gap_costs_no_model_call(self, client, db, user, monkeypatch):
        """The entire point of the feature. If this ever calls OpenAI, it fails."""
        def _boom(*args, **kwargs):
            raise AssertionError("gap-filling must not call the model")

        monkeypatch.setattr("app.services.openai_client.get_openai_client", _boom, raising=False)

        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"))
        travel = await make_travel(db, trip, name="Flight to Naha")
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/gaps/submit",
            json={
                "target": "travel",
                "recordId": travel.travel_detail_id,
                "values": {
                    "departureDateTime": "2026-10-30T09:00",
                    "arrivalDateTime": "2026-10-30T12:00",
                },
            },
        )

        assert resp.status_code == 200
        await db.refresh(travel)
        assert travel.departure_local == datetime(2026, 10, 30, 9, 0)
        assert travel.arrival_local == datetime(2026, 10, 30, 12, 0)

    async def test_the_remaining_gaps_come_back_so_the_count_goes_down(self, client, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"))
        travel = await make_travel(db, trip, name="Flight to Naha")
        await db.commit()

        before = (await client.get(f"/trips/{trip.trip_id}/gaps")).json()

        after = (await client.post(
            f"/trips/{trip.trip_id}/gaps/submit",
            json={
                "target": "travel",
                "recordId": travel.travel_detail_id,
                "values": {
                    "departureDateTime": "2026-10-30T09:00",
                    "arrivalDateTime": "2026-10-30T12:00",
                },
            },
        )).json()

        assert after["blockingCount"] < before["blockingCount"]
        assert after["totalCount"] < before["totalCount"]

    async def test_a_field_that_is_not_real_is_rejected_and_nothing_is_written(
        self, client, db, user
    ):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"))
        travel = await make_travel(db, trip, name="Flight to Naha")
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/gaps/submit",
            json={
                "target": "travel",
                "recordId": travel.travel_detail_id,
                "values": {"seatPreference": "aisle"},
            },
        )

        assert resp.status_code == 422
        await db.refresh(travel)
        assert travel.departure_local is None

    async def test_another_users_trip_is_not_reachable(self, client, db, other_user):
        trip = await make_trip(db, other_user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"))
        await db.commit()

        resp = await client.get(f"/trips/{trip.trip_id}/gaps")

        assert resp.status_code == 404
