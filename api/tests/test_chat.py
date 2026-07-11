import json
from unittest.mock import MagicMock
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.elements import BinaryExpression, BooleanClauseList, False_, Null, True_

from app.auth import require_auth
from app.database import get_db
from app.main import app
from app.models import ChatMessageRecord, TripRecord
from app.routers import chat as chat_router
from app.services.trip_state import WorkflowOutcome


client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"


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
    """Return the `done` event's data, failing loudly on an `error` event."""
    events = _sse_events(resp)
    errors = [e for e in events if e["event"] == "error"]
    assert not errors, errors
    done = [e for e in events if e["event"] == "done"]
    assert done, events
    return done[-1]["data"]


def _fake_user():
    user = MagicMock()
    user.id = USER_ID
    return user


class _FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return list(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


def _matches(rec, criterion) -> bool:
    """Evaluate a simple WHERE criterion (AND of ==, is_(True/False)) in Python.

    The idempotency lookups filter on request_id and is_bot, so the fake has to
    actually honour WHERE clauses rather than returning every row.
    """
    if isinstance(criterion, BooleanClauseList):
        return all(_matches(rec, clause) for clause in criterion.clauses)
    if isinstance(criterion, BinaryExpression):
        column = getattr(criterion.left, "key", None)
        if column is None:
            return True
        actual = getattr(rec, column, None)
        right = criterion.right
        if isinstance(right, True_):
            return actual is True
        if isinstance(right, False_):
            return actual is False or actual is None
        if isinstance(right, Null):
            return actual is None
        return actual == getattr(right, "value", right)
    return True


class _FakeSession:
    def __init__(self):
        self._store = {}
        self.flush_error = None  # set to simulate a unique-constraint clash

    async def get(self, model, pk):
        return self._store.get((model, pk))

    async def execute(self, stmt):
        table = stmt.get_final_froms()[0].name
        if table == "chat_messages":
            items = [
                rec for (model, _pk), rec in self._store.items()
                if model is ChatMessageRecord
            ]
            items = [
                rec for rec in items
                if all(_matches(rec, crit) for crit in stmt._where_criteria)
            ]
            items.sort(key=lambda rec: rec.created_at or 0)
            return _FakeResult(items)
        return _FakeResult([])

    async def rollback(self):
        return None

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None

    async def flush(self):
        return None

    def add(self, obj):
        if isinstance(obj, TripRecord):
            self._store[(TripRecord, obj.trip_id)] = obj
        elif isinstance(obj, ChatMessageRecord):
            self._store[(ChatMessageRecord, obj.message_id)] = obj


class TestChat:
    def setup_method(self):
        self.session = _FakeSession()
        app.dependency_overrides[get_db] = lambda: self.session
        app.dependency_overrides[require_auth] = _fake_user

    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_reply_creates_shell_trip_and_messages(self, monkeypatch):
        # All trip:* workflows dispatch to the tool loop.
        async def _fake_loop(
            _db,
            *,
            trip,
            transcript,
            latest_message,
            conversation_summary=None,
            ui_context=None,
            workflow_name="trip:manage",
            client=None,
        ):
            yield {"type": "status", "tool": "create_stay", "label": "Adding a stay…"}
            yield {"type": "delta", "text": "Hello world"}
            yield {
                "type": "outcome",
                "outcome": WorkflowOutcome(
                    assistantMessage="Hello world - 2026-07-08",
                    complete=False,
                    structuredContent={"tripName": "Paris Trip"},
                ),
            }

        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _fake_loop)
        resp = client.post(
            "/chat/reply",
            json={"workflowName": "trip:new_trip", "message": "help me plan a trip", "requestId": str(uuid.uuid4())},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        events = _sse_events(resp)
        assert [e["event"] for e in events] == ["status", "delta", "done"]
        assert events[0]["data"] == {"tool": "create_stay", "label": "Adding a stay…"}
        assert events[1]["data"] == {"text": "Hello world"}
        body = _done_payload(resp)
        assert body["tripId"]
        assert len(body["messages"]) == 2
        assert body["messages"][0]["isBot"] is False
        assert body["messages"][1]["isBot"] is True
        assert body["messages"][1]["structureContent"] == '{"tripName": "Paris Trip"}'

        list_resp = client.get(
            f"/chat/trips/{body['tripId']}",
            params={"workflowName": "trip:new_trip"},
        )
        assert list_resp.status_code == 200
        messages = list_resp.json()
        assert len(messages) == 2
        assert messages[0]["message"] == "help me plan a trip"

    def test_reply_routes_trip_manage_workflow(self, monkeypatch):
        async def _fake_loop(
            _db,
            *,
            trip,
            transcript,
            latest_message,
            conversation_summary=None,
            ui_context=None,
            workflow_name="trip:manage",
            client=None,
        ):
            yield {
                "type": "outcome",
                "outcome": WorkflowOutcome(
                    assistantMessage="Updated your trip day.",
                    complete=False,
                    structuredContent={
                        "actions": [{"op": "update", "target": "day", "id": "d1", "fields": {"title": "Day 1"}}],
                        "results": [{"op": "update", "target": "day", "id": "d1", "status": "ok", "detail": None}],
                    },
                ),
            }

        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _fake_loop)
        resp = client.post(
            "/chat/reply",
            json={"workflowName": "trip:manage", "message": "Rename day one", "tripId": str(uuid.uuid4()), "requestId": str(uuid.uuid4())},
        )

        assert resp.status_code == 404

        existing_trip_id = str(uuid.uuid4())
        self.session.add(
            TripRecord(
                trip_id=existing_trip_id,
                user_id=USER_ID,
                trip_name="Existing",
                start_date="2026-07-01",
                end_date="2026-07-05",
                status="draft",
            )
        )

        resp = client.post(
            "/chat/reply",
            json={"workflowName": "trip:manage", "message": "Rename day one", "tripId": existing_trip_id, "requestId": str(uuid.uuid4())},
        )

        assert resp.status_code == 200
        body = _done_payload(resp)
        assert body["tripId"] == existing_trip_id
        assert body["messages"][1]["message"] == "Updated your trip day."
        assert body["messages"][1]["structureContent"] is not None


class TestChatRouting:
    """All trip:* workflows dispatch to run_chat_tool_loop."""

    def setup_method(self):
        self.session = _FakeSession()
        app.dependency_overrides[get_db] = lambda: self.session
        app.dependency_overrides[require_auth] = _fake_user

    def teardown_method(self):
        app.dependency_overrides.clear()

    def _fake(self, calls, label):
        async def _workflow(_db, **kwargs):
            calls.append((label, kwargs.get("workflow_name")))
            yield {
                "type": "outcome",
                "outcome": WorkflowOutcome(assistantMessage=f"from {label}", complete=False),
            }

        return _workflow

    def _existing_trip(self):
        trip_id = str(uuid.uuid4())
        self.session.add(
            TripRecord(
                trip_id=trip_id,
                user_id=USER_ID,
                trip_name="Existing",
                start_date="2026-07-01",
                end_date="2026-07-05",
                status="draft",
            )
        )
        return trip_id

    def test_routes_all_trip_workflows_to_tool_loop(self, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._fake(calls, "loop"))

        resp = client.post("/chat/reply", json={"workflowName": "trip:new_trip", "message": "hi", "requestId": str(uuid.uuid4())})
        assert resp.status_code == 200
        assert _done_payload(resp)["messages"][1]["message"] == "from loop"

        trip_id = self._existing_trip()
        resp = client.post(
            "/chat/reply",
            json={"workflowName": "trip:manage", "message": "hi", "tripId": trip_id, "requestId": str(uuid.uuid4())},
        )
        assert resp.status_code == 200
        assert _done_payload(resp)["messages"][1]["message"] == "from loop"

        assert calls == [("loop", "trip:new_trip"), ("loop", "trip:manage")]

    def test_non_trip_workflow_skips_tool_loop(self, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._fake(calls, "loop"))

        resp = client.post("/chat/reply", json={"workflowName": "other", "message": "hi", "requestId": str(uuid.uuid4())})
        assert resp.status_code == 200
        assert _done_payload(resp)
        assert calls == []

    def test_loop_failure_becomes_error_event(self, monkeypatch):
        async def _boom(_db, **_kwargs):
            raise RuntimeError("kaboom")
            yield  # pragma: no cover — makes this an async generator

        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", _boom)

        resp = client.post("/chat/reply", json={"workflowName": "trip:new_trip", "message": "hi", "requestId": str(uuid.uuid4())})
        # The stream is already committed to 200; failures ride the stream.
        assert resp.status_code == 200
        events = _sse_events(resp)
        assert [e["event"] for e in events] == ["error"]
        assert "kaboom" not in events[0]["data"]["detail"]


class TestChatIdempotency:
    """review.md 3D-5: a repeated requestId must not re-run the pipeline."""

    def setup_method(self):
        self.session = _FakeSession()
        app.dependency_overrides[get_db] = lambda: self.session
        app.dependency_overrides[require_auth] = _fake_user

    def teardown_method(self):
        app.dependency_overrides.clear()

    @staticmethod
    def _counting_loop(calls):
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

    def _send(self, **overrides):
        payload = {
            "workflowName": "trip:new_trip",
            "message": "Book the Hyatt",
            "requestId": str(uuid.uuid4()),
        }
        payload.update(overrides)
        return client.post("/chat/reply", json=payload)

    def test_repeat_request_id_replays_and_skips_the_model(self, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop(calls))
        request_id = str(uuid.uuid4())

        first = self._send(requestId=request_id)
        assert first.status_code == 200
        first_payload = _done_payload(first)
        assert first_payload["messages"][1]["message"] == "reply #1"
        assert len(calls) == 1

        # The impatient double-send / network retry.
        second = self._send(requestId=request_id)
        assert second.status_code == 200
        second_payload = _done_payload(second)

        # The model was NOT called again, and the reply is byte-identical —
        # so no duplicate stay was created.
        assert len(calls) == 1
        assert second_payload == first_payload

    def test_replay_emits_only_a_done_event(self, monkeypatch):
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop([]))
        request_id = str(uuid.uuid4())
        self._send(requestId=request_id)

        events = _sse_events(self._send(requestId=request_id))
        assert [e["event"] for e in events] == ["done"]

    def test_different_request_ids_run_the_model_each_time(self, monkeypatch):
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop(calls))

        self._send(requestId=str(uuid.uuid4()))
        self._send(requestId=str(uuid.uuid4()))
        assert len(calls) == 2

    def test_request_id_is_required(self, monkeypatch):
        """No optional key: a client that omits it is rejected, not silently
        left unprotected (frontend and backend move together)."""
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop(calls))

        resp = client.post("/chat/reply", json={"workflowName": "trip:new_trip", "message": "hi"})
        assert resp.status_code == 422
        assert calls == []

    def test_failed_turn_is_not_replayed_so_a_retry_can_succeed(self, monkeypatch):
        """A turn that errored persists nothing, so the same id may be retried."""
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

        first = self._send(requestId=request_id)
        assert [e["event"] for e in _sse_events(first)] == ["error"]

        # Nothing was committed, so the retry runs for real rather than
        # replaying a reply that never existed.
        second = self._send(requestId=request_id)
        assert _done_payload(second)["messages"][1]["message"] == "recovered"
        assert len(attempts) == 2

    def test_concurrent_duplicate_loses_the_race_and_replays(self, monkeypatch):
        """The unique constraint is what serialises simultaneous sends."""
        calls = []
        monkeypatch.setattr(chat_router, "stream_chat_tool_loop", self._counting_loop(calls))
        request_id = str(uuid.uuid4())

        trip_id = str(uuid.uuid4())
        self.session.add(
            TripRecord(
                trip_id=trip_id,
                user_id=USER_ID,
                trip_name="Existing",
                start_date="2026-07-01",
                end_date="2026-07-05",
                status="draft",
            )
        )
        first_payload = _done_payload(self._send(requestId=request_id, tripId=trip_id))

        # Simulate the loser of the race: when it looked, the winner had not
        # committed yet, so it went on to claim the id — and the unique
        # constraint rejected it.
        real_stored_reply = chat_router._stored_reply
        state = {"blind": True}

        async def _blind_first_lookup(db, *, user, request_id):
            if state["blind"]:
                state["blind"] = False
                return None  # the winner's row is not visible yet
            return await real_stored_reply(db, user=user, request_id=request_id)

        async def _claim_conflict():
            raise IntegrityError("insert", {}, Exception("duplicate key"))

        monkeypatch.setattr(chat_router, "_stored_reply", _blind_first_lookup)
        monkeypatch.setattr(self.session, "flush", _claim_conflict)

        resp = self._send(requestId=request_id, tripId=trip_id)
        assert resp.status_code == 200
        assert _done_payload(resp) == first_payload
        assert len(calls) == 1  # the loser never called the model
