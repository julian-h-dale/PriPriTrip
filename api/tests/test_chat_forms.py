"""Dynamic chat forms (review.md 3F-2), against a real database.

The load-bearing property: the model names a record and some field names, and
nothing else. Types, labels, options and current values come from the server,
so a model that invents a field or an option is rejected rather than obeyed.
"""

from datetime import datetime

import pytest
import pytest_asyncio
from pydantic import ValidationError

from app.enums import StayType, TravelMode
from app.services.chat_forms import (
    FormError,
    build_form,
    describe_submission,
    validate_submission,
)
from app.services.chat_tools import TOOL_REGISTRY, RequestFormArgs
from tests.factories import make_stay, make_travel, make_trip


@pytest_asyncio.fixture
async def scenario(db, user):
    """A trip with one flight (partly filled in) and one hotel."""
    trip = await make_trip(db, user, trip_name="Kyoto Trip")
    travel = await make_travel(
        db, trip, name="Flight to Osaka", mode="flight",
        departure_local=datetime(2026, 10, 30, 9, 0),
    )
    stay = await make_stay(db, trip, name="Ritz-Carlton Kyoto", stay_type="hotel")
    return trip, travel, stay


class TestBuildForm:
    async def test_backend_supplies_labels_types_options_and_current_values(self, db, scenario):
        trip, travel, _ = scenario

        built = await build_form(
            db,
            trip=trip,
            target="travel",
            record_id=travel.travel_detail_id,
            field_names=["operator", "vehicleNumber", "mode", "departureDateTime", "confirmationNumber"],
            title="Flight details",
        )
        form = built.form
        by_name = {f.name: f for f in form.fields}

        assert form.title == "Flight details"
        assert form.target == "travel"
        assert form.record_id == travel.travel_detail_id

        # Types the model never chose:
        assert by_name["operator"].type == "text"
        assert by_name["departureDateTime"].type == "datetime"
        assert by_name["mode"].type == "select"

        # Options come from the real enum, not the model's imagination.
        assert [o.value for o in by_name["mode"].options] == [m.value for m in TravelMode]

        # Current values are prefilled from the record.
        assert by_name["mode"].value == "flight"
        assert by_name["departureDateTime"].value == "2026-10-30T09:00"
        assert by_name["operator"].value is None  # not set yet — that's the point

        # Labels are human, not field names.
        assert by_name["vehicleNumber"].label == "Flight / train number"

    async def test_stay_options_come_from_the_stay_enum(self, db, scenario):
        trip, _, stay = scenario

        built = await build_form(
            db,
            trip=trip,
            target="stay",
            record_id=stay.stay_detail_id,
            field_names=["stayType", "roomType", "checkIn"],
        )

        by_name = {f.name: f for f in built.form.fields}
        assert [o.value for o in by_name["stayType"].options] == [s.value for s in StayType]
        assert by_name["stayType"].value == "hotel"

    async def test_a_field_the_model_invented_is_rejected(self, db, scenario):
        trip, travel, _ = scenario

        with pytest.raises(FormError) as exc:
            await build_form(
                db,
                trip=trip,
                target="travel",
                record_id=travel.travel_detail_id,
                field_names=["operator", "seatPreference"],  # not a real field
            )

        assert "seatPreference" in str(exc.value)
        assert "Available:" in str(exc.value)  # tells the model what it may ask for

    async def test_an_unknown_target_is_rejected(self, db, scenario):
        trip, _, _ = scenario
        with pytest.raises(FormError):
            await build_form(db, trip=trip, target="hotel", record_id=None, field_names=["name"])

    async def test_a_record_from_another_trip_is_rejected(self, db, user, scenario):
        trip, _, _ = scenario
        other_trip = await make_trip(db, user, trip_name="Someone else's trip")
        stray = await make_travel(db, other_trip)

        with pytest.raises(FormError) as exc:
            await build_form(
                db, trip=trip, target="travel", record_id=stray.travel_detail_id,
                field_names=["operator"],
            )

        assert "on this trip" in str(exc.value)

    async def test_a_soft_deleted_record_is_rejected(self, db, user, scenario):
        trip, _, _ = scenario
        gone = await make_travel(db, trip, is_deleted=True)

        with pytest.raises(FormError):
            await build_form(
                db, trip=trip, target="travel", record_id=gone.travel_detail_id,
                field_names=["operator"],
            )

    async def test_an_invented_record_id_is_rejected_with_guidance(self, db, scenario):
        trip, _, _ = scenario

        with pytest.raises(FormError) as exc:
            await build_form(
                db, trip=trip, target="travel", record_id="travel-1", field_names=["operator"]
            )

        assert "get_trip_snapshot" in str(exc.value)

    async def test_no_record_id_builds_a_create_form(self, db, scenario):
        trip, _, _ = scenario

        built = await build_form(
            db, trip=trip, target="stay", record_id=None,
            field_names=["name", "stayType", "checkIn"],
        )

        assert built.form.record_id is None
        assert all(f.value is None for f in built.form.fields)  # nothing to prefill

    async def test_trip_form_prefills_from_the_trip_itself(self, db, scenario):
        trip, _, _ = scenario

        built = await build_form(
            db, trip=trip, target="trip", record_id=None,
            field_names=["tripName", "startDate", "endDate"],
        )

        by_name = {f.name: f for f in built.form.fields}
        assert by_name["tripName"].value == "Kyoto Trip"
        assert by_name["startDate"].type == "date"
        assert by_name["startDate"].value == "2026-10-30"


class TestValidateSubmission:
    def test_blank_fields_are_dropped_not_written_as_empty(self):
        cleaned = validate_submission(
            "travel", {"operator": "ANA", "vehicleNumber": "  ", "cabinClass": None}
        )
        assert cleaned == {"operator": "ANA"}

    def test_a_bogus_enum_value_is_rejected(self):
        with pytest.raises(FormError) as exc:
            validate_submission("travel", {"mode": "teleport"})
        assert "teleport" in str(exc.value)

    def test_a_field_that_does_not_exist_is_rejected(self):
        with pytest.raises(FormError):
            validate_submission("stay", {"name": "Hyatt", "loyaltyNumber": "X"})

    def test_an_entirely_empty_submission_is_rejected(self):
        with pytest.raises(FormError):
            validate_submission("stay", {"name": "", "roomType": None})

    def test_values_are_trimmed(self):
        assert validate_submission("stay", {"name": "  Hyatt  "}) == {"name": "Hyatt"}

    def test_describe_submission_uses_human_labels(self):
        text = describe_submission("travel", {"operator": "ANA", "vehicleNumber": "NH123"})
        assert text == "Operator / airline: ANA; Flight / train number: NH123"


class TestRequestFormTool:
    async def test_the_tool_returns_a_form_and_tells_the_model_not_to_repeat_itself(self, db, scenario):
        trip, travel, _ = scenario
        spec = TOOL_REGISTRY["request_form"]
        args = RequestFormArgs(
            target="travel",
            recordId=travel.travel_detail_id,
            fields=["operator", "vehicleNumber", "confirmationNumber"],
        )

        outcome = await spec.handler(db, trip, args)

        assert outcome.result["status"] == "ok"
        assert outcome.form is not None
        assert len(outcome.form.fields) == 3
        # The model is told the user can see the fields, so it should not ask again.
        assert "Do not also ask" in outcome.result["detail"]
        # The model does not get the field machinery back — just an acknowledgement.
        assert "options" not in outcome.result

    async def test_a_bad_form_request_comes_back_as_an_error_the_model_can_fix(self, db, scenario):
        trip, travel, _ = scenario
        spec = TOOL_REGISTRY["request_form"]
        args = RequestFormArgs(
            target="travel", recordId=travel.travel_detail_id, fields=["seatPreference"]
        )

        outcome = await spec.handler(db, trip, args)

        assert outcome.result["status"] == "error"
        assert "seatPreference" in outcome.result["detail"]
        assert outcome.form is None  # nothing shown to the user

    def test_the_model_cannot_ask_for_zero_fields(self):
        with pytest.raises(ValidationError):
            RequestFormArgs(target="stay", fields=[])


class TestSubmitEndpoint:
    """POST /chat/forms/submit — a plain save, no model call."""

    async def test_submitting_applies_the_values_to_the_record(self, client, db, user, scenario):
        import uuid

        trip, travel, _ = scenario

        resp = await client.post(
            "/chat/forms/submit",
            json={
                "tripId": trip.trip_id,
                "workflowName": "trip:manage",
                "requestId": str(uuid.uuid4()),
                "formId": str(uuid.uuid4()),
                "target": "travel",
                "recordId": travel.travel_detail_id,
                "values": {"operator": "ANA", "vehicleNumber": "NH123"},
            },
        )

        assert resp.status_code == 200
        await db.refresh(travel)
        assert travel.operator == "ANA"
        assert travel.vehicle_number == "NH123"
        # The exchange is recorded so the assistant has it next turn.
        assert [m["isBot"] for m in resp.json()["messages"]] == [False, True]

    async def test_a_bogus_value_is_rejected_and_nothing_is_written(self, client, db, scenario):
        import uuid

        trip, travel, _ = scenario

        resp = await client.post(
            "/chat/forms/submit",
            json={
                "tripId": trip.trip_id,
                "workflowName": "trip:manage",
                "requestId": str(uuid.uuid4()),
                "formId": str(uuid.uuid4()),
                "target": "travel",
                "recordId": travel.travel_detail_id,
                "values": {"mode": "teleport"},
            },
        )

        assert resp.status_code == 422
        await db.refresh(travel)
        assert travel.mode == "flight"  # unchanged

    async def test_another_users_trip_is_404(self, client, db, other_user):
        import uuid

        trip = await make_trip(db, other_user)

        resp = await client.post(
            "/chat/forms/submit",
            json={
                "tripId": trip.trip_id,
                "workflowName": "trip:manage",
                "requestId": str(uuid.uuid4()),
                "formId": str(uuid.uuid4()),
                "target": "trip",
                "recordId": None,
                "values": {"tripName": "Hijacked"},
            },
        )

        assert resp.status_code == 404
