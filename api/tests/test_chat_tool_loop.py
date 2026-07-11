"""Unit tests for the chat tool-calling loop (app/services/chat_tool_loop.py).

Uses a scripted fake async OpenAI client plus the lightweight fake-session
pattern from test_chat.py / test_trip.py, so the real executor code runs
against in-memory records with no database or network.
"""

import asyncio
import json
import uuid
from types import SimpleNamespace

from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
)
from app.services.chat_tool_loop import run_chat_tool_loop

USER_ID = "11111111-1111-1111-1111-111111111111"
TRIP_ID = "22222222-2222-2222-2222-222222222222"

_PK_ATTR = {
    TripRecord: "trip_id",
    TripDayRecord: "day_id",
    TripPointRecord: "point_id",
    StayDetailRecord: "stay_detail_id",
    TravelDetailRecord: "travel_detail_id",
    LocationRecord: "location_id",
}


class _FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return list(self._items)

    def scalar_one(self):
        # Only used for the select(func.count()) trip-summary queries.
        return len(self._items)


class _FakeSession:
    """Rows keyed by table name; get() by (model, pk). WHERE clauses are
    ignored — good enough for these scenarios."""

    def __init__(self):
        self.rows: dict[str, list] = {}
        self._store: dict = {}

    async def get(self, model, pk):
        return self._store.get((model, pk))

    async def execute(self, stmt):
        try:
            table = stmt.get_final_froms()[0].name
        except Exception:
            # DELETE statements (location replacement) land here.
            table = getattr(getattr(stmt, "table", None), "name", None)
        return _FakeResult(self.rows.get(table, []))

    async def flush(self):
        return None

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None

    def add(self, obj):
        self.rows.setdefault(obj.__table__.name, []).append(obj)
        pk_attr = _PK_ATTR.get(type(obj))
        if pk_attr:
            self._store[(type(obj), getattr(obj, pk_attr))] = obj


def _tool_call(name, arguments: dict, call_id=None):
    return SimpleNamespace(
        id=call_id or f"call_{uuid.uuid4().hex[:8]}",
        type="function",
        function=SimpleNamespace(name=name, arguments=json.dumps(arguments)),
    )


def _response(*, content=None, tool_calls=None):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content, tool_calls=tool_calls or None),
                finish_reason="tool_calls" if tool_calls else "stop",
            )
        ],
        usage=SimpleNamespace(
            total_tokens=100,
            prompt_tokens=80,
            completion_tokens=20,
            prompt_tokens_details=None,
        ),
    )


class _ScriptedClient:
    """Returns pre-scripted responses in order; records every request's kwargs."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests: list[dict] = []

        async def create(**kwargs):
            # Snapshot: the loop mutates the messages list between calls.
            recorded = dict(kwargs)
            recorded["messages"] = [dict(m) for m in kwargs.get("messages", [])]
            self.requests.append(recorded)
            if not self._responses:
                raise AssertionError("Fake client ran out of scripted responses")
            return self._responses.pop(0)

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))


def _trip(**overrides):
    rec = TripRecord(
        trip_id=TRIP_ID,
        user_id=USER_ID,
        trip_name="Kyoto Trip",
        status="new",
        start_date="2026-10-30",
        end_date="2026-11-01",
        destination_location_name="Kyoto",
    )
    for key, value in overrides.items():
        setattr(rec, key, value)
    return rec


def _run(coro):
    return asyncio.run(coro)


class TestChatToolLoop:
    def test_executes_tools_then_returns_final_message(self):
        session = _FakeSession()
        trip = _trip()
        session.add(trip)
        client = _ScriptedClient(
            [
                _response(tool_calls=[_tool_call("create_stay", {"name": "Hyatt Kyoto", "stayType": "hotel"})]),
                _response(tool_calls=[_tool_call("update_trip", {"defaultTimezoneId": "Asia/Tokyo"})]),
                _response(content="Saved the Hyatt Kyoto stay and set the trip timezone. Anything else?"),
            ]
        )

        outcome = _run(
            run_chat_tool_loop(
                session,
                trip=trip,
                transcript=[{"role": "user", "message": "We're staying at the Hyatt Kyoto"}],
                latest_message="We're staying at the Hyatt Kyoto",
                conversation_summary=None,
                ui_context={"appCurrentDate": "2026-07-10"},
                workflow_name="trip:manage",
                client=client,
            )
        )

        # Executor effects landed on the fake session.
        stays = session.rows.get("stay_details", [])
        assert len(stays) == 1
        assert stays[0].name == "Hyatt Kyoto"
        assert stays[0].stay_type == "hotel"
        assert trip.default_timezone_id == "Asia/Tokyo"

        # Final message is the model's, verbatim.
        assert outcome.assistantMessage.startswith("Saved the Hyatt Kyoto stay")
        assert outcome.complete is False
        assert outcome.verify is None

        # structuredContent shape matches what chat.py stores.
        sc = outcome.structuredContent
        assert len(sc["actions"]) == 2
        assert len(sc["persistedActions"]) == 2
        assert sc["suppressedActions"] == []
        assert [r["status"] for r in sc["results"]] == ["ok", "ok"]
        assert sc["followUpQuestion"] is None
        assert sc["toolLoop"]["iterations"] == 3
        assert sc["toolLoop"]["capHit"] is False
        assert [tc["name"] for tc in sc["toolLoop"]["toolCalls"]] == ["create_stay", "update_trip"]

        # Requests: system+user first, then assistant/tool messages appended.
        assert len(client.requests) == 3
        first_roles = [m["role"] for m in client.requests[0]["messages"]]
        assert first_roles == ["system", "user"]
        last_roles = [m["role"] for m in client.requests[2]["messages"]]
        assert last_roles == ["system", "user", "assistant", "tool", "assistant", "tool"]
        assert client.requests[0]["tool_choice"] == "auto"
        tool_names = {t["function"]["name"] for t in client.requests[0]["tools"]}
        assert {"create_stay", "update_trip", "resolve_location", "get_trip_snapshot"} <= tool_names

    def test_tool_validation_error_is_fed_back_to_model(self):
        session = _FakeSession()
        trip = _trip()
        session.add(trip)
        client = _ScriptedClient(
            [
                # Missing required "title" -> Pydantic validation error.
                _response(tool_calls=[_tool_call("create_day", {"date": "2026-10-30"})]),
                _response(content="I need a title for that day — what should I call it?"),
            ]
        )

        outcome = _run(
            run_chat_tool_loop(
                session,
                trip=trip,
                transcript=[],
                latest_message="Add a day on Oct 30",
                client=client,
            )
        )

        # Nothing was executed or persisted.
        assert session.rows.get("trip_days", []) == []
        sc = outcome.structuredContent
        assert sc["actions"] == []
        assert sc["persistedActions"] == []
        assert sc["results"] == []
        tool_calls = sc["toolLoop"]["toolCalls"]
        assert len(tool_calls) == 1
        assert tool_calls[0]["result"]["status"] == "error"
        assert "title" in tool_calls[0]["result"]["detail"]

        # The error text went back to the model as the tool result.
        second_messages = client.requests[1]["messages"]
        tool_messages = [m for m in second_messages if m["role"] == "tool"]
        assert len(tool_messages) == 1
        fed_back = json.loads(tool_messages[0]["content"])
        assert fed_back["status"] == "error"
        assert "Invalid arguments for create_day" in fed_back["detail"]
        assert "title" in fed_back["detail"]

        assert outcome.assistantMessage.startswith("I need a title")

    def test_iteration_cap_forces_wrap_up_without_tools(self):
        session = _FakeSession()
        trip = _trip()
        session.add(trip)
        responses = [
            _response(tool_calls=[_tool_call("get_trip_snapshot", {})]) for _ in range(6)
        ]
        responses.append(_response(content="I looked things over; here's where the trip stands."))
        client = _ScriptedClient(responses)

        outcome = _run(
            run_chat_tool_loop(
                session,
                trip=trip,
                transcript=[],
                latest_message="Keep checking the trip",
                client=client,
            )
        )

        # 6 tool iterations + 1 forced wrap-up call.
        assert len(client.requests) == 7
        for req in client.requests[:6]:
            assert "tools" in req
        final_req = client.requests[6]
        assert "tools" not in final_req
        assert final_req["messages"][-1] == {
            "role": "user",
            "content": "Wrap up: summarize what you did and what's still needed.",
        }

        sc = outcome.structuredContent
        assert sc["toolLoop"]["iterations"] == 6
        assert sc["toolLoop"]["capHit"] is True
        assert len(sc["toolLoop"]["toolCalls"]) == 6
        assert outcome.assistantMessage == "I looked things over; here's where the trip stands."

    def test_new_trip_completion_marks_draft_and_keeps_model_message(self):
        session = _FakeSession()
        trip = _trip(status="new")
        session.add(trip)
        client = _ScriptedClient(
            [
                _response(
                    tool_calls=[
                        _tool_call("create_stay", {"name": "Hyatt Kyoto", "stayType": "hotel"}),
                        _tool_call("create_travel", {"name": "Flight to Osaka", "mode": "flight"}),
                    ]
                ),
                _response(content="Added your stay and your flight. Want to add check-in dates next?"),
            ]
        )

        outcome = _run(
            run_chat_tool_loop(
                session,
                trip=trip,
                transcript=[],
                latest_message="We're staying at the Hyatt Kyoto and flying to Osaka",
                workflow_name="trip:new_trip",
                client=client,
            )
        )

        assert len(session.rows.get("stay_details", [])) == 1
        assert len(session.rows.get("travel_details", [])) == 1

        # Completion condition met -> complete + verify, trip promoted to draft.
        assert outcome.complete is True
        assert outcome.verify is not None
        assert trip.status == "draft"

        # The model's final message survives — no canned summary (review 3C-5).
        assert outcome.assistantMessage == "Added your stay and your flight. Want to add check-in dates next?"
        assert "trip draft is ready" not in outcome.assistantMessage

        sc = outcome.structuredContent
        assert len(sc["persistedActions"]) == 2
        assert sc["toolLoop"]["iterations"] == 2
