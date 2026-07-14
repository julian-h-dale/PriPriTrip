"""One write layer, one set of rules (review.md R1–R4 / S1).

The chat executor and the REST routers used to implement the same domain rules
independently, and the two copies drifted. Every drift was a real bug, and each
arrived as a *correct fix applied to one door and not the other*.

These tests assert the thing that actually matters: **both doors now behave the
same**. Where a test can, it drives the same scenario through the executor *and*
through HTTP and compares the rows.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.enums import TripStatus
from app.models import StayDetailRecord, TripPointRecord, active
from app.routers.trip_ai_import import _itinerary_doc_locked
from app.schemas import StayDetailPatch
from app.services.llm_contract import AssistantAction
from app.services.trip_action_executor import execute_action
from app.services.trip_status import effective_status
from app.services.trip_write import ConflictError, WriteError
from tests.factories import as_date, make_day, make_stay, make_travel, make_trip

pytestmark = pytest.mark.asyncio


async def _act(db, trip, op, target, fields=None, id=None):
    return await execute_action(
        db,
        trip=trip,
        action=AssistantAction.model_validate(
            {"op": op, "target": target, "id": id, "fields": fields or {}}
        ),
    )


# ══════════════════════════════════════════════════════════════════════════════
# R1 — content promotes the trip, whichever door it came through
# ══════════════════════════════════════════════════════════════════════════════


class TestR1ContentPromotesTheTrip:
    """A trip built by *talking* to the assistant used to stay `status="new"`.

    `promote_to_draft` was called by the routers and not by the executor. Leaving
    `new` is the only thing that locks itinerary re-import — and an itinerary import
    is a FULL REPLACE. So a trip you built by chatting could be silently deleted by
    uploading an itinerary to it, and it could never go active on its start date.
    """

    async def test_a_stay_the_assistant_creates_promotes_the_trip(self, db, user):
        trip = await make_trip(db, user, status=TripStatus.NEW)

        result = await _act(db, trip, "create", "stay", {"name": "Hyatt", "stayType": "hotel"})

        assert result.status == "ok"
        assert trip.status == TripStatus.DRAFT  # was still "new"

    async def test_a_travel_leg_the_assistant_creates_promotes_the_trip(self, db, user):
        trip = await make_trip(db, user, status=TripStatus.NEW)
        await _act(db, trip, "create", "travel", {"name": "Flight to Naha", "mode": "flight"})
        assert trip.status == TripStatus.DRAFT

    async def test_a_point_the_assistant_creates_promotes_the_trip(self, db, user):
        trip = await make_trip(db, user, status=TripStatus.NEW)
        day = await make_day(db, trip)
        await _act(
            db, trip, "create", "point",
            {"dayId": day.day_id, "type": "activity", "title": "Dinner"},
        )
        assert trip.status == TripStatus.DRAFT

    async def test_so_an_itinerary_upload_can_no_longer_wipe_a_chat_built_trip(self, db, user):
        """The reason R1 mattered."""
        trip = await make_trip(db, user, status=TripStatus.NEW)
        assert _itinerary_doc_locked(trip) is False  # empty trip: import away

        await _act(db, trip, "create", "stay", {"name": "Hyatt", "stayType": "hotel"})

        # It now has content an itinerary import would delete.
        assert _itinerary_doc_locked(trip) is True

    async def test_and_a_chat_built_trip_can_go_active(self, db, user):
        # A +/-1 day window: date.today() is the *local* date while the active window
        # resolves in UTC (default_timezone_id is null on every trip), so a same-day
        # range is flaky either side of midnight.
        today = datetime.now(UTC).date()
        trip = await make_trip(
            db, user, status=TripStatus.NEW,
            start_date=today - timedelta(days=1), end_date=today + timedelta(days=1),
        )
        assert effective_status(trip) == TripStatus.NEW  # nothing to be on

        await _act(db, trip, "create", "stay", {"name": "Hyatt", "stayType": "hotel"})

        assert effective_status(trip) == TripStatus.ACTIVE


# ══════════════════════════════════════════════════════════════════════════════
# R2 — the timezone comes from the place, whichever door it came through
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def naha(monkeypatch):
    """Google resolves "Hyatt Regency Naha" to a real place with coordinates.

    The model is *not allowed* to supply lat/lng — `ActionLocationFields` forbids
    them, because it would invent them. So the only way a chat-created location ever
    gets coordinates is this resolution step, and the only way it gets a timezone is
    from those coordinates. That is exactly the chain R2 broke.
    """

    async def _enrich(loc, *, near=None, region_code=None):
        if (loc.get("name") or "").lower().startswith("hyatt"):
            loc.update({
                "lat": 26.2154,
                "lng": 127.6896,
                "fullAddress": "3-6-20 Makishi, Naha, Okinawa",
                "googlePlaceId": "place-hyatt-naha",
            })
        return loc, None

    monkeypatch.setattr("app.services.trip_write.enrich_location_dict", _enrich)


class TestR2TheTimezoneComesFromThePlace:
    """A stay the assistant resolved to a hotel in Naha was stamped `UTC`.

    `infer_tzid_from_locations` appeared nine times in the routers and zero times in
    the executor, which used `trip.default_timezone_id or "UTC"` — and that column is
    null on every trip. A nine-hour error, right under the `startUtc` that the What's
    Next screen is built on.
    """

    async def test_the_assistant_uses_the_venues_timezone_not_utc(self, db, user, naha):
        trip = await make_trip(db, user, destination_location_name="Okinawa")

        # The model supplies a bare name. The write layer resolves it, and the
        # coordinates that come back are what give the stay a timezone. Naha is UTC+9.
        await _act(
            db, trip, "create", "stay",
            {
                "name": "Hyatt Regency Naha",
                "stayType": "hotel",
                "checkIn": "2026-10-30T16:00",
                "locations": [{"role": "venue", "name": "Hyatt Regency Naha"}],
            },
        )

        stay = (await db.execute(
            __import__("sqlalchemy").select(StayDetailRecord).where(active(StayDetailRecord))
        )).scalars().first()

        assert stay.check_in_tzid == "Asia/Tokyo"  # was "UTC"
        # 16:00 in Naha is 07:00 UTC. It used to be stored as 16:00 UTC.
        assert stay.check_in_utc == datetime.fromisoformat("2026-10-30T07:00:00+00:00")

    async def test_both_doors_agree(self, client, db, user, naha):
        """The same hotel, created two ways. The rows must match."""
        trip = await make_trip(db, user, destination_location_name="Okinawa")
        await db.commit()

        location = {"role": "venue", "name": "Hyatt Regency Naha"}

        # Door 1: the REST form.
        resp = await client.post(
            f"/trips/{trip.trip_id}/stay-details",
            json={
                "name": "Hyatt (form)",
                "stayType": "hotel",
                "checkIn": "2026-10-30T16:00",
                "locations": [{**location, "locationId": "11111111-1111-1111-1111-111111111111"}],
            },
        )
        assert resp.status_code == 201
        via_form = resp.json()

        # Door 2: the assistant.
        await _act(
            db, trip, "create", "stay",
            {
                "name": "Hyatt (chat)",
                "stayType": "hotel",
                "checkIn": "2026-10-30T16:00",
                "locations": [location],
            },
        )
        await db.commit()

        via_chat = next(
            s
            for s in (await client.get(f"/trips/{trip.trip_id}")).json()["stays"]
            if s["name"] == "Hyatt (chat)"
        )

        assert via_chat["checkInTimezoneId"] == via_form["checkInTimezoneId"] == "Asia/Tokyo"
        assert via_chat["checkIn"] == via_form["checkIn"] == "2026-10-30T16:00"

    async def test_a_date_only_check_in_means_4pm_for_both_doors(self, db, user):
        """`normalize_stay_wall_clock` was in the routers only, so the assistant's
        date-only check-in landed at midnight while the form's landed at 4pm."""
        trip = await make_trip(db, user)

        await _act(
            db, trip, "create", "stay",
            {"name": "Hyatt", "stayType": "hotel", "checkIn": "2026-10-30"},
        )
        stay = (await db.execute(
            __import__("sqlalchemy").select(StayDetailRecord).where(active(StayDetailRecord))
        )).scalars().first()

        assert stay.check_in_local == datetime(2026, 10, 30, 16, 0)  # was 00:00


# ══════════════════════════════════════════════════════════════════════════════
# R3 — the assistant can clear a field, and does not lie about it
# ══════════════════════════════════════════════════════════════════════════════


class TestR3TheAssistantCanClearAField:
    """`exclude_none=True` dropped every null the model sent.

    So "that confirmation number is wrong, remove it" → the tool returned `ok` → the
    assistant told the user it was done → the value was unchanged. It violated the
    codebase's own rule: *never tell the user something was saved unless the tool
    result said ok.* The tool DID say ok.
    """

    async def test_an_explicit_null_clears_the_column(self, db, user):
        trip = await make_trip(db, user)
        stay = await make_stay(db, trip, confirmation_number="WRONG-123")

        result = await _act(
            db, trip, "update", "stay", {"confirmationNumber": None}, id=stay.stay_detail_id
        )

        assert result.status == "ok"
        await db.refresh(stay)
        assert stay.confirmation_number is None  # was still "WRONG-123"

    async def test_an_absent_field_is_still_left_alone(self, db, user):
        """The other half: `exclude_unset` must not turn every unmentioned field into a null."""
        trip = await make_trip(db, user, trip_name="Okinawa")
        stay = await make_stay(db, trip, name="Hyatt", confirmation_number="KEEP-ME")

        await _act(db, trip, "update", "stay", {"roomType": "Twin"}, id=stay.stay_detail_id)

        await db.refresh(stay)
        assert stay.room_type == "Twin"
        assert stay.confirmation_number == "KEEP-ME"  # untouched
        assert stay.name == "Hyatt"

    async def test_the_rest_door_clears_too(self, client, db, user):
        trip = await make_trip(db, user)
        stay = await make_stay(db, trip, confirmation_number="WRONG-123")
        await db.commit()

        resp = await client.patch(
            f"/trips/{trip.trip_id}/stay-details/{stay.stay_detail_id}",
            json={"confirmationNumber": None},
        )

        assert resp.status_code == 200
        assert resp.json()["confirmationNumber"] is None


# ══════════════════════════════════════════════════════════════════════════════
# The refusals are shared too
# ══════════════════════════════════════════════════════════════════════════════


class TestRefusalsAreShared:
    async def test_a_write_error_is_a_tool_result_for_the_model(self, db, user):
        """The executor never raises. A refusal is something the model can act on."""
        trip = await make_trip(db, user)
        day = await make_day(db, trip)

        result = await _act(
            db, trip, "create", "point",
            {"dayId": day.day_id, "type": "departure", "title": "Depart ORD"},
        )

        assert result.status == "error"
        assert "travel leg" in result.detail  # it says what to do instead
        assert (await db.execute(
            __import__("sqlalchemy").select(TripPointRecord)
        )).scalars().all() == []

    async def test_the_same_refusal_is_a_422_over_http(self, client, db, user):
        trip = await make_trip(db, user)
        day = await make_day(db, trip)
        await db.commit()

        resp = await client.post(
            f"/trips/{trip.trip_id}/points",
            json={
                "pointId": "22222222-2222-2222-2222-222222222222",
                "dayId": day.day_id,
                "type": "check-in",
                "title": "Check in",
            },
        )

        assert resp.status_code == 422  # WriteError.status_code
        assert "generated" in resp.json()["detail"]

    async def test_a_collision_is_a_409_over_http(self, client, db, user):
        """ConflictError carries its own status; no router re-derives it."""
        trip = await make_trip(
            db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-30")
        )
        travel = await make_travel(
            db, trip, name="Flight",
            departure_local=datetime(2026, 10, 30, 9, 0), departure_tzid="Asia/Tokyo",
        )
        from app.services.detail_points import sync_travel_generated_points

        await sync_travel_generated_points(db, travel=travel)
        await db.commit()

        generated = (await db.execute(
            __import__("sqlalchemy").select(TripPointRecord).where(
                TripPointRecord.type == "departure"
            )
        )).scalars().first()

        resp = await client.delete(f"/trips/{trip.trip_id}/points/{generated.point_id}")
        assert resp.status_code == 409

    async def test_the_day_collision_is_surfaced_differently_on_purpose(self, client, db, user):
        """Same rule, two policies — and that is the only thing that differs.

        The assistant means "name this date" when it says create, so it adopts the
        existing day and gets told the id. A REST client that POSTs a second day onto
        an occupied date should not have asked: 409.
        """
        trip = await make_trip(
            db, user, start_date=as_date("2026-10-30"), end_date=as_date("2026-10-30")
        )
        existing = await make_day(db, trip, date=as_date("2026-10-30"), title="2026-10-30")
        await db.commit()

        # The assistant: adopted and renamed.
        result = await _act(
            db, trip, "create", "day", {"title": "Arrival in Naha", "date": "2026-10-30"}
        )
        assert result.status == "ok"
        assert result.id == existing.day_id
        assert existing.day_id in result.detail
        await db.refresh(existing)
        assert existing.title == "Arrival in Naha"
        await db.commit()

        # The REST client: 409.
        resp = await client.post(
            f"/trips/{trip.trip_id}/days",
            json={
                "dayId": "33333333-3333-3333-3333-333333333333",
                "title": "Another 30th",
                "date": "2026-10-30",
            },
        )
        assert resp.status_code == 409


class TestTheWriteLayerRaisesRatherThanReturning:
    """`trip_write` is HTTP-agnostic. It raises; the callers decide what that means."""

    async def test_write_error_carries_its_own_status(self):
        assert WriteError.status_code == 422
        assert ConflictError.status_code == 409
        assert issubclass(ConflictError, WriteError)

    async def test_a_patch_model_tracks_what_was_set(self):
        """The mechanism the whole R3 fix rests on."""
        absent = StayDetailPatch.model_validate({"name": "Hyatt"})
        explicit_null = StayDetailPatch.model_validate({"confirmationNumber": None})

        assert "confirmation_number" not in absent.model_fields_set
        assert "confirmation_number" in explicit_null.model_fields_set
        assert explicit_null.confirmation_number is None
