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

import uuid

import pytest
from sqlalchemy import func, select

from app.models import StayDetailRecord
from app.services.llm_contract import AssistantAction
from app.services.trip_action_executor import execute_action
from tests.factories import make_trip


async def _stay_count(db, trip) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(StayDetailRecord)
                .where(StayDetailRecord.trip_id == trip.trip_id)
            )
        ).scalar_one()
    )


@pytest.mark.parametrize(
    "target,noun",
    [("day", "day"), ("point", "point"), ("stay", "stay"), ("travel", "travel")],
)
@pytest.mark.parametrize("op", ["update", "delete"])
async def test_invented_id_is_rejected_not_crashed(db, user, target, noun, op):
    trip = await make_trip(db, user)
    action = AssistantAction(op=op, target=target, id=f"{noun}-1", fields={})

    result = await execute_action(db, trip=trip, action=action)

    assert result.status == "error"
    assert f"'{noun}-1'" in result.detail
    assert "get_trip_snapshot" in result.detail  # tells the model how to recover


@pytest.mark.parametrize(
    "target,noun", [("day", "Day"), ("point", "Point"), ("stay", "Stay"), ("travel", "Travel")]
)
async def test_missing_id_on_update_is_rejected(db, user, target, noun):
    trip = await make_trip(db, user)
    action = AssistantAction(op="update", target=target, id=None, fields={})

    result = await execute_action(db, trip=trip, action=action)

    assert result.status == "error"
    assert result.detail == f"{noun} id is required."


async def test_valid_uuid_that_does_not_exist_is_a_clean_not_found(db, user):
    trip = await make_trip(db, user)
    action = AssistantAction(op="update", target="day", id=str(uuid.uuid4()), fields={"title": "X"})

    result = await execute_action(db, trip=trip, action=action)

    assert result.status == "error"
    assert result.detail == "Day not found"


async def test_create_with_an_invented_id_assigns_a_server_id_and_says_so(db, user):
    trip = await make_trip(db, user)
    action = AssistantAction(
        op="create", target="stay", id="stay-1", fields={"name": "Hyatt Kyoto", "stayType": "hotel"}
    )

    result = await execute_action(db, trip=trip, action=action)

    assert result.status == "ok"
    # The model's id was not used...
    assert result.id != "stay-1"
    uuid.UUID(result.id)  # ...a real server id was issued instead
    # ...and the model is told, so it references the right record next turn.
    assert "stay-1" in result.detail
    assert result.id in result.detail
    stored = await db.get(StayDetailRecord, result.id)
    assert stored.name == "Hyatt Kyoto"


async def test_create_with_a_real_uuid_keeps_it_and_stays_quiet(db, user):
    trip = await make_trip(db, user)
    stay_id = str(uuid.uuid4())
    action = AssistantAction(
        op="create", target="stay", id=stay_id, fields={"name": "Hyatt Kyoto", "stayType": "hotel"}
    )

    result = await execute_action(db, trip=trip, action=action)

    assert result.status == "ok"
    assert result.id == stay_id
    assert result.detail is None  # nothing was reassigned, so nothing to report


async def test_same_invented_id_twice_no_longer_maps_to_two_records_silently(db, user):
    """The exact scenario 3D-5 called out: the model reuses "stay-1"."""
    trip = await make_trip(db, user)

    first = await execute_action(db, trip=trip, action=AssistantAction(
        op="create", target="stay", id="stay-1", fields={"name": "Hyatt", "stayType": "hotel"}))
    # The model now tries to *update* the record it thinks it called "stay-1".
    second = await execute_action(db, trip=trip, action=AssistantAction(
        op="update", target="stay", id="stay-1", fields={"roomType": "Suite"}))

    assert first.status == "ok"
    # Previously this silently created/targeted a different row. Now it fails
    # loudly, and the error hands back the id the model should have used.
    assert second.status == "error"
    assert "'stay-1'" in second.detail
    assert await _stay_count(db, trip) == 1


async def test_updating_by_the_returned_server_id_works(db, user):
    trip = await make_trip(db, user)
    created = await execute_action(db, trip=trip, action=AssistantAction(
        op="create", target="stay", id="stay-1", fields={"name": "Hyatt", "stayType": "hotel"}))

    updated = await execute_action(db, trip=trip, action=AssistantAction(
        op="update", target="stay", id=created.id, fields={"roomType": "Suite"}))

    assert updated.status == "ok"
    stored = await db.get(StayDetailRecord, created.id)
    assert stored.room_type == "Suite"
    assert await _stay_count(db, trip) == 1
