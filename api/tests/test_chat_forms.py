"""Dynamic chat forms (review.md 3F-2).

The load-bearing property: the model names a record and some field names, and
nothing else. Types, labels, options and current values come from the server,
so a model that invents a field or an option is rejected rather than obeyed.
"""

import asyncio
import uuid

import pytest

from app.enums import StayType, TravelMode
from app.models import StayDetailRecord, TravelDetailRecord, TripRecord
from app.services.chat_forms import (
    FormError,
    build_form,
    describe_submission,
    validate_submission,
)
from app.services.chat_tools import TOOL_REGISTRY, RequestFormArgs

from evals.fake_db import FakeSession

TRIP_ID = "22222222-2222-2222-2222-222222222222"


def _run(coro):
    return asyncio.run(coro)


def _setup():
    session = FakeSession()
    trip = TripRecord(
        trip_id=TRIP_ID,
        user_id="11111111-1111-1111-1111-111111111111",
        trip_name="Kyoto Trip",
        status="draft",
        start_date="2026-10-30",
        end_date="2026-11-05",
    )
    session.add(trip)
    travel = TravelDetailRecord(
        travel_detail_id=str(uuid.uuid4()),
        trip_id=TRIP_ID,
        name="Flight to Osaka",
        mode="flight",
        departure_date_time="2026-10-30T09:00",
        is_deleted=False,
    )
    session.add(travel)
    stay = StayDetailRecord(
        stay_detail_id=str(uuid.uuid4()),
        trip_id=TRIP_ID,
        name="Ritz-Carlton Kyoto",
        stay_type="hotel",
        is_deleted=False,
    )
    session.add(stay)
    return session, trip, travel, stay


class TestBuildForm:
    def test_backend_supplies_labels_types_options_and_current_values(self):
        session, trip, travel, _ = _setup()

        built = _run(build_form(
            session,
            trip=trip,
            target="travel",
            record_id=travel.travel_detail_id,
            field_names=["operator", "vehicleNumber", "mode", "departureDateTime", "confirmationNumber"],
            title="Flight details",
        ))
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

    def test_stay_options_come_from_the_stay_enum(self):
        session, trip, _, stay = _setup()
        built = _run(build_form(
            session, trip=trip, target="stay", record_id=stay.stay_detail_id,
            field_names=["stayType", "roomType", "checkIn"],
        ))
        by_name = {f.name: f for f in built.form.fields}
        assert [o.value for o in by_name["stayType"].options] == [s.value for s in StayType]
        assert by_name["stayType"].value == "hotel"

    def test_a_field_the_model_invented_is_rejected(self):
        session, trip, travel, _ = _setup()
        with pytest.raises(FormError) as exc:
            _run(build_form(
                session, trip=trip, target="travel", record_id=travel.travel_detail_id,
                field_names=["operator", "seatPreference"],  # not a real field
            ))
        assert "seatPreference" in str(exc.value)
        assert "Available:" in str(exc.value)  # tells the model what it may ask for

    def test_an_unknown_target_is_rejected(self):
        session, trip, _, _ = _setup()
        with pytest.raises(FormError):
            _run(build_form(session, trip=trip, target="hotel", record_id=None, field_names=["name"]))

    def test_a_record_from_another_trip_is_rejected(self):
        session, trip, _, _ = _setup()
        other = TravelDetailRecord(
            travel_detail_id=str(uuid.uuid4()), trip_id="99999999-9999-9999-9999-999999999999",
            mode="flight", is_deleted=False,
        )
        session.add(other)
        with pytest.raises(FormError) as exc:
            _run(build_form(session, trip=trip, target="travel", record_id=other.travel_detail_id,
                            field_names=["operator"]))
        assert "on this trip" in str(exc.value)

    def test_an_invented_record_id_is_rejected_with_guidance(self):
        session, trip, _, _ = _setup()
        with pytest.raises(FormError) as exc:
            _run(build_form(session, trip=trip, target="travel", record_id="travel-1",
                            field_names=["operator"]))
        assert "get_trip_snapshot" in str(exc.value)

    def test_no_record_id_builds_a_create_form(self):
        session, trip, _, _ = _setup()
        built = _run(build_form(session, trip=trip, target="stay", record_id=None,
                                field_names=["name", "stayType", "checkIn"]))
        assert built.form.record_id is None
        assert all(f.value is None for f in built.form.fields)  # nothing to prefill

    def test_trip_form_prefills_from_the_trip_itself(self):
        session, trip, _, _ = _setup()
        built = _run(build_form(session, trip=trip, target="trip", record_id=None,
                                field_names=["tripName", "startDate", "endDate"]))
        by_name = {f.name: f for f in built.form.fields}
        assert by_name["tripName"].value == "Kyoto Trip"
        assert by_name["startDate"].type == "date"
        assert by_name["startDate"].value == "2026-10-30"


class TestValidateSubmission:
    def test_blank_fields_are_dropped_not_written_as_empty(self):
        cleaned = validate_submission("travel", {"operator": "ANA", "vehicleNumber": "  ", "cabinClass": None})
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
    def test_the_tool_returns_a_form_and_tells_the_model_not_to_repeat_itself(self):
        session, trip, travel, _ = _setup()
        spec = TOOL_REGISTRY["request_form"]
        args = RequestFormArgs(
            target="travel",
            recordId=travel.travel_detail_id,
            fields=["operator", "vehicleNumber", "confirmationNumber"],
        )

        outcome = _run(spec.handler(session, trip, args))

        assert outcome.result["status"] == "ok"
        assert outcome.form is not None
        assert len(outcome.form.fields) == 3
        # The model is told the user can see the fields, so it should not ask again.
        assert "Do not also ask" in outcome.result["detail"]
        # The model does not get the field machinery back — just an acknowledgement.
        assert "options" not in outcome.result

    def test_a_bad_form_request_comes_back_as_an_error_the_model_can_fix(self):
        session, trip, travel, _ = _setup()
        spec = TOOL_REGISTRY["request_form"]
        args = RequestFormArgs(target="travel", recordId=travel.travel_detail_id, fields=["seatPreference"])

        outcome = _run(spec.handler(session, trip, args))

        assert outcome.result["status"] == "error"
        assert "seatPreference" in outcome.result["detail"]
        assert outcome.form is None  # nothing shown to the user

    def test_the_model_cannot_ask_for_zero_fields(self):
        with pytest.raises(Exception):
            RequestFormArgs(target="stay", fields=[])
