from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.auth import require_auth
from app.database import get_db
from app.main import app
from app.models import ChatMessageRecord, TripRecord
from app.routers import chat as chat_router
from app.services.new_trip_workflow import WorkflowOutcome


client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"


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


class _FakeSession:
    def __init__(self):
        self._store = {}

    async def get(self, model, pk):
        return self._store.get((model, pk))

    async def execute(self, stmt):
        table = stmt.get_final_froms()[0].name
        if table == "chat_messages":
            items = [
                rec for (model, _pk), rec in self._store.items()
                if model is ChatMessageRecord
            ]
            items.sort(key=lambda rec: rec.created_at or 0)
            return _FakeResult(items)
        return _FakeResult([])

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

    def test_reply_creates_shell_trip_and_messages(self):
        async def _fake_workflow(_db, *, trip, transcript, latest_message, client=None):
            return WorkflowOutcome(assistantMessage="Hello world - 2026-07-08", complete=False)

        original = chat_router.handle_new_trip_chat_turn
        chat_router.handle_new_trip_chat_turn = _fake_workflow
        resp = client.post(
            "/chat/reply",
            json={"workflowName": "trip:new_trip", "message": "help me plan a trip"},
        )
        chat_router.handle_new_trip_chat_turn = original
        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"]
        assert len(body["messages"]) == 2
        assert body["messages"][0]["isBot"] is False
        assert body["messages"][1]["isBot"] is True

        list_resp = client.get(
            f"/chat/trips/{body['tripId']}",
            params={"workflowName": "trip:new_trip"},
        )
        assert list_resp.status_code == 200
        messages = list_resp.json()
        assert len(messages) == 2
        assert messages[0]["message"] == "help me plan a trip"
