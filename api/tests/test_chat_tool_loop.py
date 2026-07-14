"""The chat tool-calling loop (app/services/chat_tool_loop.py).

Real database, scripted OpenAI client: the model's replies are fake, but every
tool call runs the real executor against real Postgres, so a write that would
violate a constraint fails here the way it fails in production.
"""

import json

from sqlalchemy import func, select

from app.models import StayDetailRecord, TravelDetailRecord, TripDayRecord
from app.services.chat_tool_loop import run_chat_tool_loop, stream_chat_tool_loop
from evals.mock_client import ScriptedClient, response, tool_call
from tests.factories import make_trip


async def _count(db, model, trip) -> int:
    return int(
        (
            await db.execute(
                select(func.count()).select_from(model).where(model.trip_id == trip.trip_id)
            )
        ).scalar_one()
    )


async def _rows(db, model, trip):
    return (
        await db.execute(select(model).where(model.trip_id == trip.trip_id))
    ).scalars().all()


class TestChatToolLoop:
    async def test_executes_tools_then_returns_final_message(self, db, user):
        trip = await make_trip(db, user, trip_name="Kyoto Trip", status="new")
        client = ScriptedClient(
            [
                response(tool_calls=[tool_call("create_stay", {"name": "Hyatt Kyoto", "stayType": "hotel"})]),
                response(tool_calls=[tool_call("update_trip", {"defaultTimezoneId": "Asia/Tokyo"})]),
                response(content="Saved the Hyatt Kyoto stay and set the trip timezone. Anything else?"),
            ]
        )

        outcome = await run_chat_tool_loop(
            db,
            trip=trip,
            transcript=[{"role": "user", "message": "We're staying at the Hyatt Kyoto"}],
            latest_message="We're staying at the Hyatt Kyoto",
            conversation_summary=None,
            ui_context={"appCurrentDate": "2026-07-10"},
            workflow_name="trip:manage",
            client=client,
        )

        # The executor's writes really landed in Postgres.
        stays = await _rows(db, StayDetailRecord, trip)
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
        assert sc["uiPayload"] is None
        assert sc["toolLoop"]["iterations"] == 3
        assert sc["toolLoop"]["capHit"] is False
        assert [tc["name"] for tc in sc["toolLoop"]["toolCalls"]] == ["create_stay", "update_trip"]

        # Requests: system+user first, then assistant/tool messages appended.
        assert len(client.requests) == 3
        assert [m["role"] for m in client.requests[0]["messages"]] == ["system", "user"]
        assert [m["role"] for m in client.requests[2]["messages"]] == [
            "system", "user", "assistant", "tool", "assistant", "tool",
        ]
        assert client.requests[0]["tool_choice"] == "auto"
        tool_names = {t["function"]["name"] for t in client.requests[0]["tools"]}
        assert {"create_stay", "update_trip", "resolve_location", "get_trip_snapshot", "request_form"} <= tool_names

    async def test_tool_validation_error_is_fed_back_to_model(self, db, user):
        trip = await make_trip(db, user)
        client = ScriptedClient(
            [
                # Missing required "title" -> Pydantic validation error.
                response(tool_calls=[tool_call("create_day", {"date": "2026-10-30"})]),
                response(content="I need a title for that day — what should I call it?"),
            ]
        )

        outcome = await run_chat_tool_loop(
            db, trip=trip, transcript=[], latest_message="Add a day on Oct 30", client=client
        )

        # Nothing was executed or persisted.
        assert await _count(db, TripDayRecord, trip) == 0
        sc = outcome.structuredContent
        assert sc["actions"] == []
        assert sc["persistedActions"] == []
        assert sc["results"] == []
        tool_calls = sc["toolLoop"]["toolCalls"]
        assert len(tool_calls) == 1
        assert tool_calls[0]["result"]["status"] == "error"
        assert "title" in tool_calls[0]["result"]["detail"]

        # The error text went back to the model as the tool result.
        tool_messages = [m for m in client.requests[1]["messages"] if m["role"] == "tool"]
        fed_back = json.loads(tool_messages[0]["content"])
        assert fed_back["status"] == "error"
        assert "Invalid arguments for create_day" in fed_back["detail"]

        assert outcome.assistantMessage.startswith("I need a title")

    async def test_an_executor_error_is_fed_back_to_the_model(self, db, user):
        """A real constraint failure, not a fake one: the day id is invented."""
        trip = await make_trip(db, user)
        client = ScriptedClient(
            [
                response(tool_calls=[tool_call("update_day", {"dayId": "day-1", "title": "Nope"})]),
                response(content="I couldn't find that day — which one did you mean?"),
            ]
        )

        outcome = await run_chat_tool_loop(
            db, trip=trip, transcript=[], latest_message="Rename day one", client=client
        )

        sc = outcome.structuredContent
        assert sc["persistedActions"] == []
        assert len(sc["suppressedActions"]) == 1
        tool_messages = [m for m in client.requests[1]["messages"] if m["role"] == "tool"]
        assert "not a valid day id" in json.loads(tool_messages[0]["content"])["detail"]

    async def test_iteration_cap_forces_wrap_up_without_tools(self, db, user):
        trip = await make_trip(db, user)
        responses = [response(tool_calls=[tool_call("get_trip_snapshot", {})]) for _ in range(6)]
        responses.append(response(content="I looked things over; here's where the trip stands."))
        client = ScriptedClient(responses)

        outcome = await run_chat_tool_loop(
            db, trip=trip, transcript=[], latest_message="Keep checking the trip", client=client
        )

        # 6 tool iterations + 1 forced wrap-up call.
        assert len(client.requests) == 7
        for request in client.requests[:6]:
            assert "tools" in request
        final = client.requests[6]
        assert "tools" not in final
        assert final["messages"][-1] == {
            "role": "user",
            "content": "Wrap up: summarize what you did and what's still needed.",
        }

        sc = outcome.structuredContent
        assert sc["toolLoop"]["iterations"] == 6
        assert sc["toolLoop"]["capHit"] is True
        assert outcome.assistantMessage == "I looked things over; here's where the trip stands."

    async def test_new_trip_completion_marks_draft_and_keeps_model_message(self, db, user):
        trip = await make_trip(db, user, status="new", destination_location_name="Kyoto")
        client = ScriptedClient(
            [
                response(
                    tool_calls=[
                        tool_call("create_stay", {"name": "Hyatt Kyoto", "stayType": "hotel"}),
                        tool_call("create_travel", {"name": "Flight to Osaka", "mode": "flight"}),
                    ]
                ),
                response(content="Added your stay and your flight. Want to add check-in dates next?"),
            ]
        )

        outcome = await run_chat_tool_loop(
            db,
            trip=trip,
            transcript=[],
            latest_message="We're staying at the Hyatt Kyoto and flying to Osaka",
            workflow_name="trip:new_trip",
            client=client,
        )

        assert await _count(db, StayDetailRecord, trip) == 1
        assert await _count(db, TravelDetailRecord, trip) == 1

        # Completion condition met -> complete + verify, trip promoted to draft.
        assert outcome.complete is True
        assert outcome.verify is not None
        assert trip.status == "draft"

        # The model's final message survives — no canned summary (review 3C-5).
        assert outcome.assistantMessage == "Added your stay and your flight. Want to add check-in dates next?"
        assert "trip draft is ready" not in outcome.assistantMessage

    async def test_stream_emits_status_and_delta_events_in_order(self, db, user):
        trip = await make_trip(db, user)
        client = ScriptedClient(
            [
                response(tool_calls=[tool_call("create_stay", {"name": "Hyatt Kyoto", "stayType": "hotel"})]),
                response(content="Saved the Hyatt Kyoto stay."),
            ]
        )

        events = []
        async for event in stream_chat_tool_loop(
            db, trip=trip, transcript=[], latest_message="We're staying at the Hyatt Kyoto", client=client
        ):
            events.append(event)

        assert [e["type"] for e in events] == ["status", "delta", "outcome"]
        assert events[0]["tool"] == "create_stay"
        assert events[0]["label"] == "Adding a stay…"
        assert events[1]["text"] == "Saved the Hyatt Kyoto stay."
        assert events[2]["outcome"].assistantMessage == "Saved the Hyatt Kyoto stay."

    async def test_a_requested_form_reaches_the_reply(self, db, user):
        """review.md 3F-2: request_form's form is attached to structuredContent."""
        trip = await make_trip(db, user)
        client = ScriptedClient(
            [
                response(
                    tool_calls=[
                        tool_call("create_travel", {"name": "Flight to Naha", "mode": "flight"})
                    ]
                ),
                response(content="Added the flight — fill in the details below."),
            ]
        )
        await run_chat_tool_loop(
            db, trip=trip, transcript=[], latest_message="Add my flight", client=client
        )
        travel = (await _rows(db, TravelDetailRecord, trip))[0]

        form_client = ScriptedClient(
            [
                response(
                    tool_calls=[
                        tool_call(
                            "request_form",
                            {
                                "target": "travel",
                                "recordId": travel.travel_detail_id,
                                "fields": ["operator", "vehicleNumber"],
                            },
                        )
                    ]
                ),
                response(content="I've put the flight details on a form below."),
            ]
        )

        outcome = await run_chat_tool_loop(
            db, trip=trip, transcript=[], latest_message="Where do I put the flight number?",
            client=form_client,
        )

        ui = outcome.structuredContent["uiPayload"]
        assert ui["kind"] == "form"
        assert ui["form"]["target"] == "travel"
        assert [f["name"] for f in ui["form"]["fields"]] == ["operator", "vehicleNumber"]
        # The backend supplied the labels; the model never chose them.
        assert ui["form"]["fields"][1]["label"] == "Flight / train number"
