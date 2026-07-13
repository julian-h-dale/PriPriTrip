"""Trip status, and the one transition that must never happen.

`new` and `draft` both mean "still being planned" — the UI sends both to the
timeline. `active` means you are ON the trip, and it is the only status the UI
treats specially (docs/active_trip_plan.md).

`trip.status = "draft"` used to be written raw in five places. Every one of them
would have knocked an `active` trip back to `draft` — so uploading a booking
confirmation while you were on the trip would have made the What's Next screen
silently disappear. `promote_to_draft()` is the single writer now, and it only
ever goes forwards. The demotion tests are the real content of this file.
"""

from __future__ import annotations

import io

import pytest
from openpyxl import Workbook

from app.enums import TripStatus
from app.schemas import StayDetailImport
from app.services import trip_ai
from app.services.trip_ai import AIDocumentDraft
from app.services.trip_state import promote_to_draft

from tests.factories import as_date, make_trip

pytestmark = pytest.mark.asyncio


class TestPromoteToDraft:
    async def test_a_new_trip_is_promoted(self, db, user):
        trip = await make_trip(db, user, status=TripStatus.NEW)
        promote_to_draft(trip)
        assert trip.status == TripStatus.DRAFT

    async def test_a_draft_trip_stays_draft(self, db, user):
        trip = await make_trip(db, user, status=TripStatus.DRAFT)
        promote_to_draft(trip)
        assert trip.status == TripStatus.DRAFT

    async def test_an_active_trip_is_never_demoted(self, db, user):
        """The whole reason this helper exists."""
        trip = await make_trip(db, user, status=TripStatus.ACTIVE)
        promote_to_draft(trip)
        assert trip.status == TripStatus.ACTIVE


class TestTheStatusEndpoint:
    async def test_a_trip_can_be_set_active(self, client, db, user):
        trip = await make_trip(db, user, status=TripStatus.DRAFT)
        await db.commit()

        resp = await client.patch(f"/trips/{trip.trip_id}/status", json={"status": "active"})

        assert resp.status_code == 200
        assert resp.json()["status"] == "active"
        assert (await client.get(f"/trips/{trip.trip_id}")).json()["status"] == "active"

    async def test_it_goes_back_to_planning_too(self, client, db, user):
        trip = await make_trip(db, user, status=TripStatus.ACTIVE)
        await db.commit()

        resp = await client.patch(f"/trips/{trip.trip_id}/status", json={"status": "draft"})

        assert resp.status_code == 200
        assert resp.json()["status"] == "draft"

    async def test_a_status_that_is_not_real_is_rejected(self, client, db, user):
        trip = await make_trip(db, user, status=TripStatus.DRAFT)
        await db.commit()

        resp = await client.patch(f"/trips/{trip.trip_id}/status", json={"status": "on-holiday"})

        assert resp.status_code == 422
        await db.refresh(trip)
        assert trip.status == TripStatus.DRAFT  # nothing was written

    async def test_another_users_trip_is_not_reachable(self, client, db, other_user):
        trip = await make_trip(db, other_user, status=TripStatus.DRAFT)
        await db.commit()

        resp = await client.patch(f"/trips/{trip.trip_id}/status", json={"status": "active"})

        assert resp.status_code == 404


class TestNothingDemotesAnActiveTrip:
    """Every path that used to write `status = "draft"` raw, exercised for real."""

    @pytest.fixture
    def one_stay(self, monkeypatch):
        async def _extract(_text, client=None):
            return AIDocumentDraft(
                stays=[StayDetailImport(name="Hyatt", stayType="hotel", checkIn="2026-10-30T16:00")],
                travels=[],
            )

        monkeypatch.setattr(trip_ai, "extract_document_records", _extract)

    def _booking(self) -> bytes:
        wb = Workbook()
        wb.active.append(["Hotel", "Hyatt"])
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    async def test_uploading_a_confirmation_mid_trip_keeps_it_active(
        self, client, db, user, one_stay
    ):
        """You are on the trip; you upload your hotel booking. You are still on the trip."""
        trip = await make_trip(
            db, user, status=TripStatus.ACTIVE,
            start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"),
        )
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/ai-documents",
            files={"file": ("booking.xlsx", self._booking(), "application/vnd.ms-excel")},
            data={"workflowMode": "detail_import"},
        )
        assert resp.status_code == 200

        await db.refresh(trip)
        assert trip.status == TripStatus.ACTIVE  # was "draft"

    async def test_importing_a_trip_payload_keeps_it_active(self, client, db, user):
        trip = await make_trip(
            db, user, status=TripStatus.ACTIVE,
            start_date=as_date("2026-10-30"), end_date=as_date("2026-11-05"),
        )
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/import",
            json={
                "tripId": trip.trip_id,
                "tripName": "Okinawa Trip",
                "startDate": "2026-10-30",
                "endDate": "2026-11-05",
                "stays": [],
                "travels": [],
                "days": [],
            },
        )
        assert resp.status_code == 200

        await db.refresh(trip)
        assert trip.status == TripStatus.ACTIVE

    async def test_a_brand_new_import_still_becomes_draft(self, client, user):
        """The promotion still has to work — it is what locks itinerary re-import."""
        trip_id = "77777777-7777-7777-7777-777777777777"

        resp = await client.post(
            f"/trips/{trip_id}/import",
            json={
                "tripId": trip_id,
                "tripName": "Fresh Trip",
                "startDate": "2026-10-30",
                "endDate": "2026-11-05",
                "stays": [],
                "travels": [],
                "days": [],
            },
        )
        assert resp.status_code == 200

        trip = (await client.get(f"/trips/{trip_id}")).json()
        assert trip["status"] == "draft"


class TestThePointCarriesItsInstant:
    async def test_start_utc_is_serialised_so_the_browser_need_not_guess(
        self, client, db, user
    ):
        """What's Next compares against `now`; a wall clock cannot be compared."""
        from datetime import datetime

        from tests.factories import make_travel
        from app.services.detail_points import sync_travel_generated_points

        trip = await make_trip(
            db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-30"),
        )
        travel = await make_travel(
            db, trip, name="Flight to Naha",
            departure_local=datetime(2026, 10, 30, 9, 0), departure_tzid="Asia/Tokyo",
        )
        await sync_travel_generated_points(db, travel=travel)
        await db.commit()

        body = (await client.get(f"/trips/{trip.trip_id}")).json()
        point = body["days"][0]["points"][0]

        # 09:00 in Tokyo is 00:00 UTC — the wall clock alone could not tell you that.
        assert point["startDateTime"] == "2026-10-30T09:00"
        assert point["startUtc"].startswith("2026-10-30T00:00")
