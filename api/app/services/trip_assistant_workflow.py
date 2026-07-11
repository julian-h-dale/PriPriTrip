from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import StayDetailRecord, TravelDetailRecord, TripDayRecord, TripPointRecord, TripRecord
from app.services.ai_trace import log_ai_event
from app.services.llm_contract import AssistantTurn
from app.services.new_trip_workflow import WorkflowOutcome
from app.services.new_trip_workflow import _assembled_trip
from app.services.openai_client import get_async_client, parse_structured
from app.services.prompt_composer import build_trip_assistant_prompt
from app.services.trip_action_executor import apply_assistant_turn


async def _count_active_rows(db: AsyncSession, model, trip_id: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(model)
        .where(
            model.trip_id == trip_id,
            model.is_deleted.is_(False),
            model.deleted_at.is_(None),
        )
    )
    return int(result.scalar_one() or 0)


async def _trip_summary(db: AsyncSession, trip: TripRecord) -> dict[str, Any]:
    return {
        "tripId": trip.trip_id,
        "tripName": trip.trip_name,
        "status": trip.status,
        "startDate": trip.start_date,
        "endDate": trip.end_date,
        "startLocationName": trip.start_location_name,
        "destinationLocationName": trip.destination_location_name,
        "defaultTimezoneId": trip.default_timezone_id,
        "daysCount": await _count_active_rows(db, TripDayRecord, trip.trip_id),
        "pointsCount": await _count_active_rows(db, TripPointRecord, trip.trip_id),
        "staysCount": await _count_active_rows(db, StayDetailRecord, trip.trip_id),
        "travelsCount": await _count_active_rows(db, TravelDetailRecord, trip.trip_id),
    }


def _conversation_prompt(
    summary: dict[str, Any],
    trip_snapshot: dict[str, Any],
    transcript: list[dict],
    latest_message: str,
    conversation_summary: str | None = None,
    ui_context: dict | None = None,
) -> str:
    return (
        "Runtime context contract (backend authoritative context):\n"
        f"{json.dumps(ui_context or {}, indent=2)}\n\n"
        "Current trip state:\n"
        f"{json.dumps(summary, indent=2)}\n\n"
        "Current full trip snapshot:\n"
        f"{json.dumps(trip_snapshot, indent=2)}\n\n"
        "Conversation summary of older turns (if any):\n"
        f"{conversation_summary or ''}\n\n"
        "Conversation so far:\n"
        f"{json.dumps(transcript, indent=2)}\n\n"
        "Latest user message:\n"
        f"{latest_message}"
    )


def _recent_assistant_questions(transcript: list[dict], limit: int = 5) -> list[str]:
    questions: list[str] = []
    for item in reversed(transcript):
        if item.get("role") != "assistant":
            continue
        message = (item.get("message") or "").strip()
        if not message:
            continue
        if "?" in message:
            questions.append(message)
        if len(questions) >= limit:
            break
    return list(reversed(questions))


async def handle_trip_assistant_chat_turn(
    db: AsyncSession,
    *,
    trip: TripRecord,
    transcript: list[dict],
    latest_message: str,
    conversation_summary: str | None = None,
    ui_context: dict | None = None,
    client=None,
) -> WorkflowOutcome:
    client = client or get_async_client()

    summary = await _trip_summary(db, trip)
    trip_snapshot = (await _assembled_trip(db, trip)).model_dump(mode="json", by_alias=True)
    log_ai_event(
        "ai.trip_assistant.turn.start",
        tripId=trip.trip_id,
        tripStatus=trip.status,
        summary=summary,
        tripSnapshot=trip_snapshot,
        transcript=transcript,
        latestMessage=latest_message,
        conversationSummary=conversation_summary,
        uiContext=ui_context,
    )
    turn = await parse_structured(
        client,
        system=build_trip_assistant_prompt(),
        user=_conversation_prompt(
            summary,
            trip_snapshot,
            transcript,
            latest_message,
            conversation_summary,
            ui_context,
        ),
        response_format=AssistantTurn,
        pass_name="trip-assistant",
        event_prefix="ai.trip_assistant.openai",
    )

    applied = await apply_assistant_turn(
        db,
        trip=trip,
        turn=turn,
        latest_message=latest_message,
        recent_assistant_questions=_recent_assistant_questions(transcript),
    )

    payload = {
        "actions": [action.model_dump(mode="json") for action in turn.actions],
        "persistedActions": [action.model_dump(mode="json") for action in applied.persistedActions],
        "suppressedActions": applied.suppressedActions,
        "results": [result.model_dump(mode="json") for result in applied.results],
        "assumptions": [item.model_dump(mode="json") for item in applied.assumptions],
        "unresolvedItems": [item.model_dump(mode="json") for item in applied.unresolvedItems],
        "followUpQuestion": applied.followUpQuestion,
        "confidence": turn.confidence,
    }

    assistant_text = applied.assistantMessage
    if applied.followUpQuestion:
        assistant_text = f"{assistant_text}\n\n{applied.followUpQuestion}".strip()

    log_ai_event(
        "ai.trip_assistant.turn.outcome",
        tripId=trip.trip_id,
        assistantMessage=assistant_text,
        payload=payload,
    )

    return WorkflowOutcome(
        assistantMessage=assistant_text,
        complete=False,
        structuredContent=payload,
    )
