"""A date has at most one real day.

Three writers create days — `reconcile_trip_days` (from the trip's date range),
`_get_or_create_day_for_date` (a flight has to land on *some* day), and whoever
names it: the model, the importer, the UI. None of them checked whether the date
already had a day, so a flight saved before the day was named produced two rows
for July 25th:

    2026-07-25            (placeholder, made to hold the departure point)
    Arrival in Houston    (the model, naming the same date)

Alternates are exempt on purpose: a second plan for the same date is what they
are for.
"""

from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy import select

from app.models import TripDayRecord, TripPointRecord, active
from app.services.detail_points import (
    primary_day_for_date,
    reconcile_trip_days,
    sync_travel_generated_points,
)
from app.services.llm_contract import AssistantAction
from app.services.trip_action_executor import execute_action
from app.services.trip_state import assembled_trip

from tests.factories import as_date, make_day, make_travel, make_trip

pytestmark = pytest.mark.asyncio


async def _days(db, trip, day_date=None) -> list[TripDayRecord]:
    query = select(TripDayRecord).where(
        TripDayRecord.trip_id == trip.trip_id, active(TripDayRecord)
    )
    if day_date is not None:
        query = query.where(TripDayRecord.date == day_date)
    return list((await db.execute(query.order_by(TripDayRecord.date))).scalars().all())


class TestTheOrderingThatCausedIt:
    async def test_naming_a_date_that_already_has_a_day_renames_it(self, db, user):
        """The exact sequence from the bug: flight first, then the model names the day."""
        trip = await make_trip(db, user, start_date=as_date("2026-07-09"), end_date=as_date("2026-07-09"))

        # Saving the flight invents a placeholder day to hang its points on.
        travel = await make_travel(
            db, trip, name="Flight to Houston",
            departure_local=datetime(2026, 7, 25, 16, 0), departure_tzid="America/Chicago",
            arrival_local=datetime(2026, 7, 25, 18, 30), arrival_tzid="America/Chicago",
        )
        await sync_travel_generated_points(db, travel=travel)
        await db.flush()
        assert [d.title for d in await _days(db, trip, date(2026, 7, 25))] == ["2026-07-25"]

        # Then the model names that date.
        result = await execute_action(
            db, trip=trip,
            action=AssistantAction.model_validate({
                "op": "create", "target": "day",
                "fields": {"title": "Arrival in Houston", "date": "2026-07-25"},
            }),
        )

        assert result.status == "ok"
        [day] = await _days(db, trip, date(2026, 7, 25))
        assert day.title == "Arrival in Houston"  # renamed, not duplicated
        assert result.id == day.day_id
        # The model must be told which id to use, or it will add points to a
        # day that does not exist.
        assert day.day_id in result.detail

    async def test_the_renamed_day_keeps_the_points_already_on_it(self, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-07-09"), end_date=as_date("2026-07-09"))
        travel = await make_travel(
            db, trip, name="Flight to Houston",
            departure_local=datetime(2026, 7, 25, 16, 0), departure_tzid="America/Chicago",
        )
        await sync_travel_generated_points(db, travel=travel)
        await db.flush()

        await execute_action(
            db, trip=trip,
            action=AssistantAction.model_validate({
                "op": "create", "target": "day",
                "fields": {"title": "Arrival in Houston", "date": "2026-07-25"},
            }),
        )

        [day] = await _days(db, trip, date(2026, 7, 25))
        points = (await db.execute(
            select(TripPointRecord).where(
                TripPointRecord.day_id == day.day_id, active(TripPointRecord)
            )
        )).scalars().all()
        assert [p.type for p in points] == ["departure"]


class TestOnePrimaryDayPerDate:
    async def test_reconcile_makes_exactly_one_day_per_date(self, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-11-02"))

        await reconcile_trip_days(db, trip)
        await reconcile_trip_days(db, trip)  # idempotent

        days = await _days(db, trip)
        assert [d.date for d in days] == [
            date(2026, 10, 30), date(2026, 10, 31), date(2026, 11, 1), date(2026, 11, 2)
        ]

    async def test_moving_a_day_onto_an_occupied_date_is_refused(self, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-31"))
        await reconcile_trip_days(db, trip)
        await db.flush()
        mover = await primary_day_for_date(db, trip_id=trip.trip_id, day_date=date(2026, 10, 31))

        result = await execute_action(
            db, trip=trip,
            action=AssistantAction.model_validate({
                "op": "update", "target": "day", "id": mover.day_id,
                "fields": {"date": "2026-10-30"},
            }),
        )

        assert result.status == "error"
        assert "already has a day" in result.detail
        assert len(await _days(db, trip, date(2026, 10, 30))) == 1

    async def test_an_alternate_may_share_a_date(self, db, user):
        """A second plan for the same date is the whole point of alternates."""
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-30"))
        await reconcile_trip_days(db, trip)
        await db.flush()

        result = await execute_action(
            db, trip=trip,
            action=AssistantAction.model_validate({
                "op": "create", "target": "day",
                "fields": {"title": "Rainy day plan", "date": "2026-10-30", "isAlternate": True},
            }),
        )

        assert result.status == "ok"
        days = await _days(db, trip, date(2026, 10, 30))
        assert len(days) == 2
        assert sorted(d.is_alternate for d in days) == [False, True]

    async def test_primary_day_lookup_ignores_alternates(self, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-30"))
        await make_day(db, trip, date=as_date("2026-10-30"), title="Alt", is_alternate=True)
        real = await make_day(db, trip, date=as_date("2026-10-30"), title="The real one")

        found = await primary_day_for_date(db, trip_id=trip.trip_id, day_date=date(2026, 10, 30))

        assert found.day_id == real.day_id


class TestSavingATripGivesItItsDays:
    async def test_put_trips_creates_a_day_per_date(self, client, user):
        """Dates and day rows are the same fact, so saving one saves the other.

        Without this a trip has a date range and an empty timeline, and the
        first flight to land on one of those dates quietly invents the day it
        needed — under a placeholder title, which is where the duplicates began.
        """
        trip_id = "44444444-4444-4444-4444-444444444444"

        resp = await client.put(
            f"/trips/{trip_id}",
            json={
                "tripId": trip_id,
                "tripName": "Houston",
                "startDate": "2026-07-25",
                "endDate": "2026-07-28",
            },
        )
        assert resp.status_code == 200

        trip = (await client.get(f"/trips/{trip_id}")).json()
        assert [d["date"] for d in trip["days"]] == [
            "2026-07-25", "2026-07-26", "2026-07-27", "2026-07-28"
        ]

    async def test_saving_the_same_trip_again_does_not_add_more(self, client, user):
        trip_id = "55555555-5555-5555-5555-555555555555"
        body = {
            "tripId": trip_id,
            "tripName": "Houston",
            "startDate": "2026-07-25",
            "endDate": "2026-07-28",
        }

        await client.put(f"/trips/{trip_id}", json=body)
        await client.put(f"/trips/{trip_id}", json=body)

        trip = (await client.get(f"/trips/{trip_id}")).json()
        assert len(trip["days"]) == 4


class TestRenderingDaysWeJustInserted:
    async def test_a_turn_that_changes_the_dates_can_still_render_the_trip(self, db, user):
        """One session inserting days and then serialising them.

        `created_at` is a server default (NOW()), so SQLAlchemy leaves it
        unloaded on a freshly inserted row and fetches it on first touch. That
        touch is Pydantic, which is sync — and a lazy load from sync code under
        asyncio raises MissingGreenlet. It only bites when a single session both
        writes the rows and renders them, which is precisely a chat turn where
        the model moves the trip's dates: the executor reconciles the day rows,
        and the same turn assembles the trip on the way out.

        `eager_defaults` on the declarative Base is what keeps this working.
        """
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-30"))

        result = await execute_action(
            db, trip=trip,
            action=AssistantAction.model_validate({
                "op": "update", "target": "trip",
                "fields": {"startDate": "2026-10-30", "endDate": "2026-11-02"},
            }),
        )
        assert result.status == "ok"

        rendered = await assembled_trip(db, trip)  # this used to blow up

        assert [d.date for d in rendered.days] == [
            date(2026, 10, 30), date(2026, 10, 31), date(2026, 11, 1), date(2026, 11, 2)
        ]
        assert all(day.created_at for day in rendered.days)


class TestTheRestApiHoldsTheLine:
    async def test_posting_a_day_for_an_occupied_date_is_rejected(self, client, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-30"))
        await reconcile_trip_days(db, trip)
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/days",
            json={
                "dayId": "22222222-2222-2222-2222-222222222222",
                "title": "Another 30th",
                "date": "2026-10-30",
            },
        )

        assert resp.status_code == 409
        assert "already has a day" in resp.json()["detail"]
        assert len(await _days(db, trip, date(2026, 10, 30))) == 1

    async def test_an_alternate_is_still_allowed_through_the_api(self, client, db, user):
        trip = await make_trip(db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-30"))
        await reconcile_trip_days(db, trip)
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/days",
            json={
                "dayId": "33333333-3333-3333-3333-333333333333",
                "title": "Rainy day plan",
                "date": "2026-10-30",
                "isAlternate": True,
            },
        )

        assert resp.status_code == 201
