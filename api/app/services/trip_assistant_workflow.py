from __future__ import annotations

import json
import os
import time
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import StayDetailRecord, TravelDetailRecord, TripDayRecord, TripPointRecord, TripRecord
from app.services.ai_trace import log_ai_event
from app.services.llm_contract import AssistantTurn
from app.services.new_trip_workflow import WorkflowOutcome
from app.services.new_trip_workflow import _assembled_trip
from app.services.prompt_composer import build_trip_assistant_prompt
from app.services.trip_action_executor import apply_assistant_turn

_DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4")
_REQUEST_TIMEOUT = float(os.environ.get("OPENAI_TIMEOUT", "120"))
_MAX_RETRIES = int(os.environ.get("OPENAI_MAX_RETRIES", "2"))


def _client():
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is not configured on the server.",
        )
    return OpenAI(api_key=api_key, timeout=_REQUEST_TIMEOUT, max_retries=_MAX_RETRIES)


def _parse(client, *, system: str, user: str, response_format, pass_name: str):
    started = time.monotonic()
    log_ai_event(
        "ai.trip_assistant.openai.request",
        passName=pass_name,
        model=_DEFAULT_MODEL,
        requestTimeoutSeconds=_REQUEST_TIMEOUT,
        maxRetries=_MAX_RETRIES,
        systemPrompt=system,
        userPrompt=user,
    )
    try:
        completion = client.beta.chat.completions.parse(
            model=_DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format=response_format,
        )
    except Exception as exc:
        log_ai_event(
            "ai.trip_assistant.openai.error",
            passName=pass_name,
            elapsedSeconds=round(time.monotonic() - started, 3),
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI request failed: {exc}",
        ) from exc

    message = completion.choices[0].message
    usage = getattr(completion, "usage", None)
    prompt_details = getattr(usage, "prompt_tokens_details", None) if usage else None
    log_ai_event(
        "ai.trip_assistant.openai.response_meta",
        passName=pass_name,
        elapsedSeconds=round(time.monotonic() - started, 3),
        finishReason=(completion.choices[0].finish_reason if completion.choices else None),
        totalTokens=(getattr(usage, "total_tokens", None) if usage else None),
        promptTokens=(getattr(usage, "prompt_tokens", None) if usage else None),
        completionTokens=(getattr(usage, "completion_tokens", None) if usage else None),
        cachedPromptTokens=(getattr(prompt_details, "cached_tokens", None) if prompt_details else None),
        refusal=getattr(message, "refusal", None),
    )
    if getattr(message, "refusal", None):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI refused the request: {message.refusal}",
        )
    parsed = message.parsed
    if parsed is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI did not return a parseable {pass_name} response.",
        )
    log_ai_event(
        "ai.trip_assistant.openai.parsed",
        passName=pass_name,
        parsed=parsed,
    )
    return parsed


async def _trip_summary(db: AsyncSession, trip: TripRecord) -> dict[str, Any]:
    day_result = await db.execute(
        select(TripDayRecord).where(
            TripDayRecord.trip_id == trip.trip_id,
            TripDayRecord.is_deleted.is_(False),
            TripDayRecord.deleted_at.is_(None),
        )
    )
    point_result = await db.execute(
        select(TripPointRecord).where(
            TripPointRecord.trip_id == trip.trip_id,
            TripPointRecord.is_deleted.is_(False),
            TripPointRecord.deleted_at.is_(None),
        )
    )
    stay_result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip.trip_id,
            StayDetailRecord.is_deleted.is_(False),
            StayDetailRecord.deleted_at.is_(None),
        )
    )
    travel_result = await db.execute(
        select(TravelDetailRecord).where(
            TravelDetailRecord.trip_id == trip.trip_id,
            TravelDetailRecord.is_deleted.is_(False),
            TravelDetailRecord.deleted_at.is_(None),
        )
    )
    return {
        "tripId": trip.trip_id,
        "tripName": trip.trip_name,
        "status": trip.status,
        "startDate": trip.start_date,
        "endDate": trip.end_date,
        "startLocationName": trip.start_location_name,
        "destinationLocationName": trip.destination_location_name,
        "defaultTimezoneId": trip.default_timezone_id,
        "daysCount": len(day_result.scalars().all()),
        "pointsCount": len(point_result.scalars().all()),
        "staysCount": len(stay_result.scalars().all()),
        "travelsCount": len(travel_result.scalars().all()),
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
    client = client or _client()

    summary = await _trip_summary(db, trip)
    trip_snapshot = (await _assembled_trip(db, trip)).model_dump(mode="json")
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
    turn = _parse(
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
