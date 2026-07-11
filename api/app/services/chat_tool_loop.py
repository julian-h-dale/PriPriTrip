"""Tool-calling loop for the chat assistant (review.md 3A target architecture).

Replaces the one-shot structured-output workflows for interactive chat: the
model gets per-target tools (app/services/chat_tools.py), calls them until it
is done, and its final plain message is what the user sees. Executor errors
come back as tool results, so the model observes and corrects its own
failures within the turn (review.md 3C-3). A deterministic verify_trip
checklist in the context replaces the welcome/travel/stay stage machine
(review.md 3D-2).

Enabled via Settings.chat_assistant_mode == "loop"; "batch" falls back to the
legacy one-shot workflows (kill switch).
"""

from __future__ import annotations

import json
import logging
import time

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TripRecord
from app.services.ai_trace import log_ai_event
from app.services.chat_tools import TOOL_REGISTRY, openai_tools
from app.services.new_trip_workflow import (
    WorkflowOutcome,
    _assembled_trip,
    _mark_trip_draft_after_chat_completion,
)
from app.services.openai_client import get_async_client, get_model
from app.services.prompt_composer import build_tool_loop_prompt
from app.services.trip_assistant_workflow import _trip_summary
from app.services.trip_verify import verify_trip

logger = logging.getLogger("app.services.chat_tool_loop")

_MAX_TOOL_ITERATIONS = 6
_GENERIC_AI_ERROR = "The AI service request failed. Please try again."
_WRAP_UP_NUDGE = "Wrap up: summarize what you did and what's still needed."
_FALLBACK_FINAL_MESSAGE = "I've processed your request. Let me know what you'd like to do next."


def _build_context_message(
    *,
    summary: dict,
    verify_payload: dict,
    transcript: list[dict],
    latest_message: str,
    conversation_summary: str | None,
    ui_context: dict | None,
) -> str:
    return (
        "Runtime context contract (backend authoritative context):\n"
        f"{json.dumps(ui_context or {}, indent=2)}\n\n"
        "Current trip state (compact — call get_trip_snapshot for full detail):\n"
        f"{json.dumps(summary, indent=2)}\n\n"
        "Trip completeness checklist (deterministic verify_trip output — what's missing):\n"
        f"{json.dumps(verify_payload, indent=2)}\n\n"
        "Conversation summary of older turns (if any):\n"
        f"{conversation_summary or ''}\n\n"
        "Conversation so far:\n"
        f"{json.dumps(transcript, indent=2)}\n\n"
        "Latest user message:\n"
        f"{latest_message}"
    )


def _usage_fields(completion) -> dict:
    usage = getattr(completion, "usage", None)
    prompt_details = getattr(usage, "prompt_tokens_details", None) if usage else None
    return {
        "totalTokens": getattr(usage, "total_tokens", None) if usage else None,
        "promptTokens": getattr(usage, "prompt_tokens", None) if usage else None,
        "completionTokens": getattr(usage, "completion_tokens", None) if usage else None,
        "cachedPromptTokens": getattr(prompt_details, "cached_tokens", None) if prompt_details else None,
    }


async def _create_completion(client, *, messages: list[dict], tools: list[dict] | None):
    kwargs: dict = {"model": get_model(), "messages": messages}
    if tools is not None:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    started = time.monotonic()
    try:
        completion = await client.chat.completions.create(**kwargs)
    except Exception as exc:
        log_ai_event(
            "ai.chat_loop.error",
            elapsedSeconds=round(time.monotonic() - started, 3),
            error=str(exc),
        )
        logger.exception("OpenAI request failed in chat tool loop")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_GENERIC_AI_ERROR,
        ) from exc
    return completion


def _serialize_tool_call(tc) -> dict:
    return {
        "id": tc.id,
        "type": "function",
        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
    }


async def _dispatch_tool_call(db: AsyncSession, trip: TripRecord, tc) -> tuple[dict, object | None, object | None]:
    """Validate + execute one tool call.

    Returns (json_result, AssistantAction | None, ActionResult | None).
    Validation errors become the tool result instead of raising — errors are
    the model's feedback channel.
    """
    name = tc.function.name
    spec = TOOL_REGISTRY.get(name)
    if spec is None:
        return {"status": "error", "detail": f"Unknown tool: {name}"}, None, None

    try:
        raw_args = json.loads(tc.function.arguments or "{}")
    except json.JSONDecodeError as exc:
        return {"status": "error", "detail": f"Tool arguments were not valid JSON: {exc}"}, None, None

    try:
        args = spec.args_model.model_validate(raw_args)
    except ValidationError as exc:
        return {"status": "error", "detail": f"Invalid arguments for {name}: {exc}"}, None, None

    outcome = await spec.handler(db, trip, args)
    return outcome.result, outcome.action, outcome.action_result


async def run_chat_tool_loop(
    db: AsyncSession,
    *,
    trip: TripRecord,
    transcript: list[dict],
    latest_message: str,
    conversation_summary: str | None = None,
    ui_context: dict | None = None,
    workflow_name: str = "trip:manage",
    client=None,
) -> WorkflowOutcome:
    client = client or get_async_client()

    summary = await _trip_summary(db, trip)
    verify_payload = verify_trip(await _assembled_trip(db, trip)).model_dump(mode="json", by_alias=True)

    messages: list[dict] = [
        {"role": "system", "content": build_tool_loop_prompt()},
        {
            "role": "user",
            "content": _build_context_message(
                summary=summary,
                verify_payload=verify_payload,
                transcript=transcript,
                latest_message=latest_message,
                conversation_summary=conversation_summary,
                ui_context=ui_context,
            ),
        },
    ]
    tools = openai_tools()

    log_ai_event(
        "ai.chat_loop.start",
        tripId=trip.trip_id,
        workflowName=workflow_name,
        tripStatus=trip.status,
        summary=summary,
        verify=verify_payload,
        transcript=transcript,
        latestMessage=latest_message,
        conversationSummary=conversation_summary,
        uiContext=ui_context,
        toolCount=len(tools),
    )

    iterations = 0
    cap_hit = False
    final_text = ""
    tool_call_log: list[dict] = []
    attempted_actions: list = []
    persisted_actions: list = []
    suppressed_actions: list[dict] = []
    action_results: list = []

    while True:
        iterations += 1
        log_ai_event(
            "ai.chat_loop.request",
            tripId=trip.trip_id,
            iteration=iterations,
            messageCount=len(messages),
        )
        completion = await _create_completion(client, messages=messages, tools=tools)
        msg = completion.choices[0].message
        tool_calls = list(getattr(msg, "tool_calls", None) or [])

        if not tool_calls:
            final_text = (getattr(msg, "content", None) or "").strip()
            log_ai_event(
                "ai.chat_loop.final",
                tripId=trip.trip_id,
                iteration=iterations,
                capHit=False,
                assistantMessage=final_text,
                **_usage_fields(completion),
            )
            break

        messages.append(
            {
                "role": "assistant",
                "content": getattr(msg, "content", None),
                "tool_calls": [_serialize_tool_call(tc) for tc in tool_calls],
            }
        )

        for tc in tool_calls:
            log_ai_event(
                "ai.chat_loop.tool_call",
                tripId=trip.trip_id,
                iteration=iterations,
                toolCallId=tc.id,
                toolName=tc.function.name,
                arguments=tc.function.arguments,
                **_usage_fields(completion),
            )
            result, action, action_result = await _dispatch_tool_call(db, trip, tc)
            if action is not None:
                attempted_actions.append(action)
            if action_result is not None:
                action_results.append(action_result)
                if action_result.status == "ok" and action is not None:
                    persisted_actions.append(action)
                elif action is not None:
                    suppressed_actions.append(
                        {"action": action.model_dump(mode="json"), "reason": action_result.detail}
                    )
            tool_call_log.append(
                {
                    "iteration": iterations,
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                    "result": result,
                }
            )
            log_ai_event(
                "ai.chat_loop.tool_result",
                tripId=trip.trip_id,
                iteration=iterations,
                toolCallId=tc.id,
                toolName=tc.function.name,
                result=result,
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result),
                }
            )

        if iterations >= _MAX_TOOL_ITERATIONS:
            # Cap protection: one last call WITHOUT tools so the turn ends
            # with an honest summary instead of an abandoned tool call.
            cap_hit = True
            messages.append({"role": "user", "content": _WRAP_UP_NUDGE})
            completion = await _create_completion(client, messages=messages, tools=None)
            final_text = (getattr(completion.choices[0].message, "content", None) or "").strip()
            log_ai_event(
                "ai.chat_loop.final",
                tripId=trip.trip_id,
                iteration=iterations,
                capHit=True,
                assistantMessage=final_text,
                **_usage_fields(completion),
            )
            break

    final_text = final_text or _FALLBACK_FINAL_MESSAGE

    structured_content = {
        "actions": [action.model_dump(mode="json") for action in attempted_actions],
        "persistedActions": [action.model_dump(mode="json") for action in persisted_actions],
        "suppressedActions": suppressed_actions,
        "results": [result.model_dump(mode="json") for result in action_results],
        "followUpQuestion": None,
        "toolLoop": {
            "iterations": iterations,
            "capHit": cap_hit,
            "toolCalls": tool_call_log,
        },
    }

    # New-trip completion: same condition the batch workflow uses today, but
    # the model's final message is kept verbatim (review.md 3C-5 — no canned
    # summary hijacking the conversation).
    complete = False
    verify = None
    if workflow_name == "trip:new_trip":
        refreshed = await _trip_summary(db, trip)
        complete = (
            refreshed["staysCount"] > 0
            and refreshed["travelsCount"] > 0
            and bool(trip.destination_location_name)
            and bool(trip.start_date)
            and bool(trip.end_date)
        )
        if complete:
            _mark_trip_draft_after_chat_completion(trip)
            verify = verify_trip(await _assembled_trip(db, trip))

    log_ai_event(
        "ai.chat_loop.outcome",
        tripId=trip.trip_id,
        workflowName=workflow_name,
        complete=complete,
        iterations=iterations,
        capHit=cap_hit,
        structured=structured_content,
        assistantMessage=final_text,
    )

    return WorkflowOutcome(
        assistantMessage=final_text,
        complete=complete,
        verify=verify,
        structuredContent=structured_content,
    )
