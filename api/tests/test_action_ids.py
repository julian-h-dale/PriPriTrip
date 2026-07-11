"""Record-id handling in the action executor (review.md 3D-5).

The model invents ids like "stay-1". Two failure modes came out of that:

- on update/delete, the invented id used to be handed straight to a UUID
  column, which raised and killed the whole turn;
- on create, it was silently swapped for a fresh UUID, so the model believed
  it had named a record the DB had never heard of — and the *same* invented id
  reused later mapped to a second, different row.

Both are now observable: invalid ids are rejected with an error the model can
read and correct, and a reassignment says so.
"""

import asyncio
import uuid

import pytest

from app.models import StayDetailRecord, TripDayRecord, TripPointRecord, TravelDetailRecord, TripRecord
from app.services.llm_contract import AssistantAction
from app.services.trip_action_executor import execute_action

from evals.fake_db import FakeSession

TRIP_ID = "22222222-2222-2222-2222-222222222222"


def _run(coro):
    return asyncio.run(coro)


def _trip():
    return TripRecord(
        trip_id=TRIP_ID,
        user_id="11111111-1111-1111-1111-111111111111",
        trip_name="Kyoto Trip",
        status="draft",
        start_date="2026-10-30",
        end_date="2026-11-05",
    )


def _session():
    session = FakeSession()
    trip = _trip()
    session.add(trip)
    return session, trip


@pytest.mark.parametrize(
    "target,noun",
    [("day", "day"), ("point", "point"), ("stay", "stay"), ("travel", "travel")],
)
@pytest.mark.parametrize("op", ["update", "delete"])
def test_invented_id_is_rejected_not_crashed(target, noun, op):
    session, trip = _session()
    action = AssistantAction(op=op, target=target, id=f"{noun}-1", fields={})

    result = _run(execute_action(session, trip=trip, action=action))

    assert result.status == "error"
    assert f"'{noun}-1'" in result.detail
    assert "get_trip_snapshot" in result.detail  # tells the model how to recover


@pytest.mark.parametrize("target,noun", [("day", "Day"), ("point", "Point"), ("stay", "Stay"), ("travel", "Travel")])
def test_missing_id_on_update_is_rejected(target, noun):
    session, trip = _session()
    action = AssistantAction(op="update", target=target, id=None, fields={})

    result = _run(execute_action(session, trip=trip, action=action))

    assert result.status == "error"
    assert result.detail == f"{noun} id is required."


def test_valid_uuid_that_does_not_exist_is_a_clean_not_found():
    session, trip = _session()
    action = AssistantAction(op="update", target="day", id=str(uuid.uuid4()), fields={"title": "X"})

    result = _run(execute_action(session, trip=trip, action=action))

    assert result.status == "error"
    assert result.detail == "Day not found"


def test_create_with_an_invented_id_assigns_a_server_id_and_says_so():
    session, trip = _session()
    action = AssistantAction(
        op="create", target="stay", id="stay-1", fields={"name": "Hyatt Kyoto", "stayType": "hotel"}
    )

    result = _run(execute_action(session, trip=trip, action=action))

    assert result.status == "ok"
    # The model's id was not used...
    assert result.id != "stay-1"
    uuid.UUID(result.id)  # ...a real server id was issued instead
    # ...and the model is told, so it references the right record next turn.
    assert "stay-1" in result.detail
    assert result.id in result.detail
    assert session.rows["stay_details"][0].stay_detail_id == result.id


def test_create_with_a_real_uuid_keeps_it_and_stays_quiet():
    session, trip = _session()
    stay_id = str(uuid.uuid4())
    action = AssistantAction(
        op="create", target="stay", id=stay_id, fields={"name": "Hyatt Kyoto", "stayType": "hotel"}
    )

    result = _run(execute_action(session, trip=trip, action=action))

    assert result.status == "ok"
    assert result.id == stay_id
    assert result.detail is None  # nothing was reassigned, so nothing to report


def test_same_invented_id_twice_no_longer_maps_to_two_records_silently():
    """The exact scenario 3D-5 called out: the model reuses "stay-1"."""
    session, trip = _session()

    first = _run(execute_action(session, trip=trip, action=AssistantAction(
        op="create", target="stay", id="stay-1", fields={"name": "Hyatt", "stayType": "hotel"})))
    # The model now tries to *update* the record it thinks it called "stay-1".
    second = _run(execute_action(session, trip=trip, action=AssistantAction(
        op="update", target="stay", id="stay-1", fields={"roomType": "Suite"})))

    assert first.status == "ok"
    # Previously this silently created/targeted a different row. Now it fails
    # loudly, and the error hands back the id the model should have used.
    assert second.status == "error"
    assert "'stay-1'" in second.detail
    assert len(session.rows["stay_details"]) == 1


def test_updating_by_the_returned_server_id_works():
    session, trip = _session()
    created = _run(execute_action(session, trip=trip, action=AssistantAction(
        op="create", target="stay", id="stay-1", fields={"name": "Hyatt", "stayType": "hotel"})))

    updated = _run(execute_action(session, trip=trip, action=AssistantAction(
        op="update", target="stay", id=created.id, fields={"roomType": "Suite"})))

    assert updated.status == "ok"
    assert session.rows["stay_details"][0].room_type == "Suite"
    assert len(session.rows["stay_details"]) == 1
