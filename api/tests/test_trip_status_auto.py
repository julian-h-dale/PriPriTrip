"""A trip is active while its dates say it is underway.

Derived, never stored (services/trip_status.py). The moment you persist "active"
you have two sources of truth — the column and the clock — and they drift: a trip
would stay active forever after it ended, or need a cron job to notice.

What the column stores is *intent*:

    new     no content yet. Never active.
    draft   has content. AUTOMATIC — active exactly while underway.
    active  forced on regardless of the dates.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.enums import TripStatus
from app.services.trip_status import effective_status, is_underway
from tests.factories import as_date, make_trip

pytestmark = pytest.mark.asyncio

# A trip running Oct 30 – Nov 5.
START = as_date("2026-10-30")
END = as_date("2026-11-05")


def at(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=UTC)


class TestIsUnderway:
    async def test_before_the_trip_it_is_not(self, db, user):
        trip = await make_trip(db, user, start_date=START, end_date=END)
        assert is_underway(trip, at("2026-10-29T23:59")) is False

    async def test_on_the_first_day_it_is(self, db, user):
        trip = await make_trip(db, user, start_date=START, end_date=END)
        assert is_underway(trip, at("2026-10-30T00:00")) is True

    async def test_on_the_last_day_it_still_is(self, db, user):
        """Inclusive: you are on the trip on its last day, not until the morning of it."""
        trip = await make_trip(db, user, start_date=START, end_date=END)
        assert is_underway(trip, at("2026-11-05T23:00")) is True

    async def test_the_day_after_it_is_over(self, db, user):
        trip = await make_trip(db, user, start_date=START, end_date=END)
        assert is_underway(trip, at("2026-11-06T00:01")) is False

    async def test_the_boundary_is_the_trips_own_midnight(self, db, user):
        """A trip to Okinawa starts on Okinawa's Oct 30, not Chicago's."""
        trip = await make_trip(
            db, user, start_date=START, end_date=END, default_timezone_id="Asia/Tokyo",
        )
        # 15:00 UTC on the 29th is already 00:00 on the 30th in Tokyo.
        assert is_underway(trip, at("2026-10-29T15:00")) is True
        # ...and 14:00 UTC is still the 29th there.
        assert is_underway(trip, at("2026-10-29T14:00")) is False

    async def test_a_junk_timezone_falls_back_to_utc_rather_than_exploding(self, db, user):
        trip = await make_trip(
            db, user, start_date=START, end_date=END, default_timezone_id="Mars/Olympus",
        )
        assert is_underway(trip, at("2026-10-30T12:00")) is True


class TestEffectiveStatus:
    async def test_a_draft_trip_goes_active_by_itself(self, db, user):
        """The whole feature."""
        trip = await make_trip(db, user, status=TripStatus.DRAFT, start_date=START, end_date=END)

        assert effective_status(trip, at("2026-10-29T12:00")) == TripStatus.DRAFT
        assert effective_status(trip, at("2026-10-31T12:00")) == TripStatus.ACTIVE
        assert effective_status(trip, at("2026-11-06T12:00")) == TripStatus.DRAFT

    async def test_it_deactivates_by_itself_too(self, db, user):
        """No cron, no stale 'active' six months after you got home."""
        trip = await make_trip(db, user, status=TripStatus.DRAFT, start_date=START, end_date=END)
        assert effective_status(trip, at("2027-05-01T12:00")) == TripStatus.DRAFT

    async def test_a_new_trip_is_never_active(self, db, user):
        """There is nothing to be on."""
        trip = await make_trip(db, user, status=TripStatus.NEW, start_date=START, end_date=END)
        assert effective_status(trip, at("2026-10-31T12:00")) == TripStatus.NEW

    async def test_active_can_be_forced_on_before_the_trip(self, db, user):
        """You arrived early. Say so."""
        trip = await make_trip(db, user, status=TripStatus.ACTIVE, start_date=START, end_date=END)
        assert effective_status(trip, at("2026-10-01T12:00")) == TripStatus.ACTIVE

    async def test_a_trip_with_no_dates_is_not_active(self, db, user):
        trip = await make_trip(db, user, status=TripStatus.DRAFT)
        trip.start_date = None
        trip.end_date = None
        assert effective_status(trip, at("2026-10-31T12:00")) == TripStatus.DRAFT


class TestTheApiReportsTheDerivedStatus:
    async def test_a_trip_underway_reads_as_active_without_anyone_setting_it(
        self, client, db, user
    ):
        today = datetime.now(UTC).date()
        trip = await make_trip(
            db, user,
            status=TripStatus.DRAFT,
            start_date=today - timedelta(days=1),
            end_date=today + timedelta(days=3),
        )
        await db.commit()

        # Nobody called PATCH /status. The dates did it.
        assert (await client.get(f"/trips/{trip.trip_id}")).json()["status"] == "active"

        listed = (await client.get("/trips")).json()
        assert next(t for t in listed if t["tripId"] == trip.trip_id)["status"] == "active"

        # The stored value is untouched — the truth lives in the clock.
        await db.refresh(trip)
        assert trip.status == TripStatus.DRAFT

    async def test_the_list_and_the_detail_agree(self, client, db, user):
        """Two readers, one function — or the chip and the screen disagree."""
        today = datetime.now(UTC).date()
        planned = await make_trip(
            db, user, trip_name="Later",
            status=TripStatus.DRAFT,
            start_date=today + timedelta(days=30),
            end_date=today + timedelta(days=35),
        )
        await db.commit()

        detail = (await client.get(f"/trips/{planned.trip_id}")).json()["status"]
        listed = next(
            t for t in (await client.get("/trips")).json() if t["tripId"] == planned.trip_id
        )["status"]

        assert detail == listed == "draft"

    async def test_setting_draft_mid_trip_reports_active_not_draft(self, client, db, user):
        """"Planning" means "go back to automatic" — and automatically, you're on it.

        Echoing the stored value back would flicker the UI to the timeline and then
        flip straight back on the next fetch.
        """
        today = datetime.now(UTC).date()
        trip = await make_trip(
            db, user, status=TripStatus.ACTIVE,
            start_date=today, end_date=today + timedelta(days=2),
        )
        await db.commit()

        resp = await client.patch(f"/trips/{trip.trip_id}/status", json={"status": "draft"})

        assert resp.status_code == 200
        assert resp.json()["status"] == "active"  # the dates win
        await db.refresh(trip)
        assert trip.status == TripStatus.DRAFT  # ...but the intent was stored


class TestContentPromotesATrip:
    """`draft` means "has content" — from *any* path, not just import and chat.

    It used to mean "has content that arrived via an import or the assistant".
    Hand-enter a flight through the travel form and the trip stayed `new`, which
    is dangerous: an itinerary import is a FULL REPLACE (it deletes every point,
    day, stay and travel), and `status != "new"` is the only thing that locks it
    out. A trip you built by hand could be silently wiped by an itinerary upload.
    It also meant such a trip could never go active on its start date.
    """

    async def test_adding_a_travel_leg_by_hand_promotes_the_trip(self, client, db, user):
        trip = await make_trip(
            db, user, status=TripStatus.NEW, start_date=START, end_date=END,
        )
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/travel-details",
            json={
                "travelDetailId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "name": "Flight to Naha",
                "mode": "flight",
            },
        )
        assert resp.status_code in (200, 201)

        await db.refresh(trip)
        assert trip.status == TripStatus.DRAFT  # was still "new"

    async def test_adding_a_stay_by_hand_promotes_the_trip(self, client, db, user):
        trip = await make_trip(db, user, status=TripStatus.NEW, start_date=START, end_date=END)
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/stay-details",
            json={
                "stayDetailId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                "name": "Hyatt",
                "stayType": "hotel",
            },
        )
        assert resp.status_code in (200, 201)

        await db.refresh(trip)
        assert trip.status == TripStatus.DRAFT

    async def test_a_hand_built_trip_is_protected_from_an_itinerary_wipe(self, client, db, user):
        """The reason this matters."""
        from app.routers.trip_ai_import import _itinerary_doc_locked

        trip = await make_trip(db, user, status=TripStatus.NEW, start_date=START, end_date=END)
        await db.commit()

        assert _itinerary_doc_locked(trip) is False  # empty trip: import away

        await client.post(
            f"/trips/{trip.trip_id}/travel-details",
            json={
                "travelDetailId": "cccccccc-cccc-cccc-cccc-cccccccccccc",
                "name": "Flight to Naha",
                "mode": "flight",
            },
        )
        await db.refresh(trip)

        # Now it has content an itinerary import would delete.
        assert _itinerary_doc_locked(trip) is True

    async def test_and_it_can_then_go_active_on_its_start_date(self, client, db, user):
        from datetime import date as _date

        today = datetime.now(UTC).date()
        trip = await make_trip(
            db, user, status=TripStatus.NEW,
            start_date=today, end_date=today + timedelta(days=2),
        )
        await db.commit()
        assert effective_status(trip) == TripStatus.NEW  # empty: nothing to be on

        await client.post(
            f"/trips/{trip.trip_id}/travel-details",
            json={
                "travelDetailId": "dddddddd-dddd-dddd-dddd-dddddddddddd",
                "name": "Flight to Naha",
                "mode": "flight",
            },
        )
        await db.refresh(trip)

        assert isinstance(trip.start_date, _date)
        assert effective_status(trip) == TripStatus.ACTIVE


class TestTheItineraryLockReadsTheStoredValue:
    async def test_being_underway_does_not_unlock_itinerary_reimport(self, db, user):
        """Whether you're mid-flight has nothing to do with importing a second itinerary.

        The lock is `trip.status != "new"` and it reads the *column*, not the
        derived status. A `new` trip that happens to fall inside its own date range
        must stay importable.
        """
        from app.routers.trip_ai_import import _itinerary_doc_locked

        today = datetime.now(UTC).date()
        trip = await make_trip(
            db, user, status=TripStatus.NEW,
            start_date=today, end_date=today + timedelta(days=2),
        )

        assert is_underway(trip) is True  # the calendar says yes
        assert _itinerary_doc_locked(trip) is False  # ...and the lock does not care
