"""Tests for POST /chat/reply (real DB).

The fake session used to ignore WHERE clauses, so the idempotency lookups
(filtered by request_id and is_bot) had to be hand-taught how to filter. Now
the real query runs, and the unique constraint that makes the whole scheme
work is actually enforced.
"""

import json
import uuid

import pytest
from sqlalchemy import func, select

from app.models import ChatMessageRecord
from app.routers import chat as chat_router
from app.services.trip_state import WorkflowOutcome
from tests.factories import make_trip


def _sse_events(resp) -> list[dict]:
    """Parse a text/event-stream body into [{"event": ..., "data": ...}]."""
    events = []
    for frame in resp.text.strip().split("\n\n"):
        name = "message"
        data_lines = []
        for line in frame.split("\n"):
            if line.startswith("event:"):
                name = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())
        if data_lines:
            events.append({"event": name, "data": json.loads("\n".join(data_lines))})
    return events


def _done_payload(resp) -> dict:
    events = _sse_events(resp)
    errors = [e for e in events if e["event"] == "error"]
    assert not errors, errors
    done = [e for e in events if e["event"] == "done"]
    assert done, events
    return done[-1]["data"]


def _loop_yielding(message="Hello world", *, structured=None, complete=False, calls=None):
    async def _fake_loop(_db, **kwargs):
        if calls is not None:
            calls.append(kwargs.get("workflow_name"))
        yield {"type": "status", "tool": "create_stay", "label": "Adding a stay…"}
        yield {"type": "delta", "text": message}
        yield {
            "type": "outcome",
            "outcome": WorkflowOutcome(
                assistantMessage=message,
                complete=complete,
                structuredContent=structured,
            ),
        }

    return _fake_loop


async def _message_count(db) -> int:
    return int(
        (await db.execute(select(func.count()).select_from(ChatMessageRecord))).scalar_one()
    )


class TestChatReply:
    async def test_reply_creates_a_shell_trip_and_persists_both_messages(
        self, client, db, user, monkeypatch
    ):
        monkeypatch.setattr(
            chat_router,
            "stream_chat_tool_loop",
            _loop_yielding("Hello world", structured={"tripName": "Paris Trip"}),
        )

        resp = await client.post(
            "/chat/reply",
            json={
                "workflowName": "trip:new_trip",
                "message": "help me plan a trip",
                "requestId": str(uuid.uuid4()),
            },
        )

        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        events = _sse_events(resp)
        assert [e["event"] for e in events] == ["status", "delta", "done"]

        body = _done_payload(resp)
        assert body["tripId"]
        assert [m["isBot"] for m in body["messages"]] == [False, True]
        assert body["messages"][1]["structureContent"] == '{"tripName": "Paris Trip"}'

        # Both rows really landed in chat_messages.
        assert await _message_count(db) == 2

        listing = await client.get(
            f"/chat/trips/{body['tripId']}", params={"workflowName": "trip:new_trip"}
        )
        assert [m["message"] for m in listing.json()] == ["help me plan a trip", "Hello world"]

    async def test_reply_on_an_existing_trip(self, client, db, user, monkeypatch):
        trip = await make_trip(db, user)
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _loop_yielding("Updated your day."))

        resp = await client.post(
            "/chat/reply",
            json={
                "workflowName": "trip:manage",
                "message": "Rename day one",
                "tripId": trip.trip_id,
                "requestId": str(uuid.uuid4()),
            },
        )

        assert _done_payload(resp)["tripId"] == trip.trip_id

    async def test_another_users_trip_is_404_and_nothing_is_written(
        self, client, db, other_user, monkeypatch
    ):
        trip = await make_trip(db, other_user)
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _loop_yielding())

        resp = await client.post(
            "/chat/reply",
            json={
                "workflowName": "trip:manage",
                "message": "hi",
                "tripId": trip.trip_id,
                "requestId": str(uuid.uuid4()),
            },
        )

        assert resp.status_code == 404
        assert await _message_count(db) == 0

    async def test_unknown_trip_is_404(self, client, monkeypatch):
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _loop_yielding())
        resp = await client.post(
            "/chat/reply",
            json={
                "workflowName": "trip:manage",
                "message": "hi",
                "tripId": str(uuid.uuid4()),
                "requestId": str(uuid.uuid4()),
            },
        )
        assert resp.status_code == 404

    async def test_non_trip_workflow_skips_the_model(self, client, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _loop_yielding(calls=calls))

        resp = await client.post(
            "/chat/reply",
            json={"workflowName": "other", "message": "hi", "requestId": str(uuid.uuid4())},
        )

        assert resp.status_code == 200
        assert _done_payload(resp)
        assert calls == []

    async def test_all_trip_workflows_route_to_the_tool_loop(self, client, db, user, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _loop_yielding(calls=calls))
        trip = await make_trip(db, user)

        await client.post(
            "/chat/reply",
            json={"workflowName": "trip:new_trip", "message": "hi", "requestId": str(uuid.uuid4())},
        )
        await client.post(
            "/chat/reply",
            json={
                "workflowName": "trip:manage",
                "message": "hi",
                "tripId": trip.trip_id,
                "requestId": str(uuid.uuid4()),
            },
        )

        assert calls == ["trip:new_trip", "trip:manage"]

    async def test_a_failed_turn_writes_nothing(self, client, db, monkeypatch):
        async def _boom(_db, **_kwargs):
            raise RuntimeError("kaboom")
            yield  # pragma: no cover — makes this an async generator

        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _boom)

        resp = await client.post(
            "/chat/reply",
            json={"workflowName": "trip:new_trip", "message": "hi", "requestId": str(uuid.uuid4())},
        )

        # The stream is already committed to 200, so the failure rides it.
        assert resp.status_code == 200
        events = _sse_events(resp)
        assert [e["event"] for e in events] == ["error"]
        assert "kaboom" not in events[0]["data"]["detail"]
        assert await _message_count(db) == 0  # the whole turn rolled back


class TestChatIdempotency:
    """review.md 3D-5: a repeated requestId must not re-run the pipeline."""

    def _counting_loop(self, calls):
        async def _loop(_db, **kwargs):
            calls.append(kwargs.get("latest_message"))
            yield {
                "type": "outcome",
                "outcome": WorkflowOutcome(
                    assistantMessage=f"reply #{len(calls)}",
                    complete=False,
                    structuredContent={"actions": [{"op": "create", "target": "stay"}]},
                ),
            }

        return _loop

    async def _send(self, client, **overrides):
        payload = {
            "workflowName": "trip:new_trip",
            "message": "Book the Hyatt",
            "requestId": str(uuid.uuid4()),
        }
        payload.update(overrides)
        return await client.post("/chat/reply", json=payload)

    async def test_repeat_request_id_replays_and_skips_the_model(self, client, db, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop(calls))
        request_id = str(uuid.uuid4())

        first = _done_payload(await self._send(client, requestId=request_id))
        assert len(calls) == 1

        second = _done_payload(await self._send(client, requestId=request_id))

        assert len(calls) == 1  # the model was NOT called again
        assert second == first  # byte-identical reply
        assert await _message_count(db) == 2  # and no extra rows

    async def test_replay_emits_only_a_done_event(self, client, monkeypatch):
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop([]))
        request_id = str(uuid.uuid4())
        await self._send(client, requestId=request_id)

        events = _sse_events(await self._send(client, requestId=request_id))

        assert [e["event"] for e in events] == ["done"]

    async def test_different_request_ids_run_the_model_each_time(self, client, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop(calls))

        await self._send(client)
        await self._send(client)

        assert len(calls) == 2

    async def test_request_id_is_required(self, client, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop(calls))

        resp = await client.post(
            "/chat/reply", json={"workflowName": "trip:new_trip", "message": "hi"}
        )

        assert resp.status_code == 422
        assert calls == []

    async def test_the_unique_constraint_really_blocks_a_duplicate_claim(self, client, db, user):
        """The DB constraint is what serialises concurrent duplicate sends."""
        from sqlalchemy.exc import IntegrityError

        trip = await make_trip(db, user)
        request_id = str(uuid.uuid4())
        for _ in range(2):
            db.add(
                ChatMessageRecord(
                    message_id=str(uuid.uuid4()),
                    user_id=str(user.id),
                    trip_id=trip.trip_id,
                    workflow_name="trip:manage",
                    message="hi",
                    is_bot=False,
                    request_id=request_id,
                )
            )

        with pytest.raises(IntegrityError):
            await db.flush()

    async def test_a_failed_turn_can_be_retried_with_the_same_id(self, client, db, monkeypatch):
        attempts = []

        async def _flaky(_db, **kwargs):
            attempts.append(kwargs.get("latest_message"))
            if len(attempts) == 1:
                raise RuntimeError("model exploded")
            yield {
                "type": "outcome",
                "outcome": WorkflowOutcome(assistantMessage="recovered", complete=False),
            }

        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _flaky)
        request_id = str(uuid.uuid4())

        first = await self._send(client, requestId=request_id)
        assert [e["event"] for e in _sse_events(first)] == ["error"]

        # Nothing was committed, so the id is free and the retry runs for real.
        second = await self._send(client, requestId=request_id)
        assert _done_payload(second)["messages"][1]["message"] == "recovered"
        assert len(attempts) == 2
