"""Tool-calling loop for the chat assistant (review.md 3A target architecture).

The model gets per-target tools (app/services/chat_tools.py), calls them until
it is done, and its final plain message is what the user sees. Executor errors
come back as tool results, so the model observes and corrects its own
failures within the turn (review.md 3C-3). A deterministic verify_trip
checklist in the context replaces the welcome/travel/stay stage machine
(review.md 3D-2).
"""

from __future__ import annotations

import json
import logging
import time
from types import SimpleNamespace
from typing import AsyncIterator

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TripRecord
from app.services.ai_trace import log_ai_event
from app.services.chat_tools import TOOL_REGISTRY, openai_tools
from app.services.openai_client import get_async_client, get_model
from app.services.prompt_composer import build_tool_loop_prompt
from app.services.trip_state import (
    WorkflowOutcome,
    assembled_trip,
    mark_trip_draft_after_chat_completion,
    trip_summary,
)
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


def _usage_fields(usage) -> dict:
    prompt_details = getattr(usage, "prompt_tokens_details", None) if usage else None
    return {
        "totalTokens": getattr(usage, "total_tokens", None) if usage else None,
        "promptTokens": getattr(usage, "prompt_tokens", None) if usage else None,
        "completionTokens": getattr(usage, "completion_tokens", None) if usage else None,
        "cachedPromptTokens": getattr(prompt_details, "cached_tokens", None) if prompt_details else None,
    }


async def _stream_completion(client, *, messages: list[dict], tools: list[dict] | None):
    """Stream one completion, yielding ("delta", text, None) for each content
    chunk and finally ("message", assembled_message, usage).

    Tool-call deltas are accumulated by index into the same message shape the
    non-streaming API returns, so the loop below is agnostic to streaming.
    """
    kwargs: dict = {
        "model": get_model(),
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if tools is not None:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    started = time.monotonic()
    content_parts: list[str] = []
    tool_slots: dict[int, dict] = {}
    usage = None
    try:
        stream = await client.chat.completions.create(**kwargs)
        async for chunk in stream:
            if getattr(chunk, "usage", None):
                usage = chunk.usage
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = choices[0].delta
            text = getattr(delta, "content", None)
            if text:
                content_parts.append(text)
                yield ("delta", text, None)
            for tc in getattr(delta, "tool_calls", None) or []:
                slot = tool_slots.setdefault(tc.index, {"id": None, "name": "", "arguments": ""})
                if getattr(tc, "id", None):
                    slot["id"] = tc.id
                fn = getattr(tc, "function", None)
                if fn is not None:
                    if getattr(fn, "name", None):
                        slot["name"] = fn.name
                    if getattr(fn, "arguments", None):
                        slot["arguments"] += fn.arguments
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

    message = SimpleNamespace(
        content="".join(content_parts) or None,
        tool_calls=[
            SimpleNamespace(
                id=slot["id"] or f"call_{index}",
                type="function",
                function=SimpleNamespace(name=slot["name"], arguments=slot["arguments"]),
            )
            for index, slot in sorted(tool_slots.items())
        ]
        or None,
    )
    yield ("message", message, usage)


def _tool_status_label(name: str) -> str:
    """Human-readable interim status for a tool call ("Adding a stay…")."""
    if name == "resolve_location":
        return "Looking up locations…"
    if name == "get_trip_snapshot":
        return "Reviewing the trip…"
    op, _, target = name.partition("_")
    verbs = {"create": "Adding", "update": "Updating", "delete": "Removing"}
    nouns = {
        "trip": "trip details",
        "day": "a day",
        "point": "an activity",
        "stay": "a stay",
        "travel": "a travel leg",
    }
    if op in verbs and target in nouns:
        return f"{verbs[op]} {nouns[target]}…"
    return "Working…"


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


async def stream_chat_tool_loop(
    db: AsyncSession,
    *,
    trip: TripRecord,
    transcript: list[dict],
    latest_message: str,
    conversation_summary: str | None = None,
    ui_context: dict | None = None,
    workflow_name: str = "trip:manage",
    client=None,
) -> AsyncIterator[dict]:
    """Run the tool loop, yielding UI events as they happen.

    Event dicts:
    - {"type": "status", "tool": name, "label": text} — before each tool runs
    - {"type": "delta", "text": chunk} — assistant message tokens
    - {"type": "outcome", "outcome": WorkflowOutcome} — always last
    """
    client = client or get_async_client()

    summary = await trip_summary(db, trip)
    verify_payload = verify_trip(await assembled_trip(db, trip)).model_dump(mode="json", by_alias=True)

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
        msg = None
        usage = None
        async for kind, payload, chunk_usage in _stream_completion(client, messages=messages, tools=tools):
            if kind == "delta":
                yield {"type": "delta", "text": payload}
            else:
                msg, usage = payload, chunk_usage
        tool_calls = list(msg.tool_calls or [])

        if not tool_calls:
            final_text = (msg.content or "").strip()
            log_ai_event(
                "ai.chat_loop.final",
                tripId=trip.trip_id,
                iteration=iterations,
                capHit=False,
                assistantMessage=final_text,
                **_usage_fields(usage),
            )
            break

        messages.append(
            {
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [_serialize_tool_call(tc) for tc in tool_calls],
            }
        )

        for tc in tool_calls:
            yield {"type": "status", "tool": tc.function.name, "label": _tool_status_label(tc.function.name)}
            log_ai_event(
                "ai.chat_loop.tool_call",
                tripId=trip.trip_id,
                iteration=iterations,
                toolCallId=tc.id,
                toolName=tc.function.name,
                arguments=tc.function.arguments,
                **_usage_fields(usage),
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
            msg = None
            usage = None
            async for kind, payload, chunk_usage in _stream_completion(client, messages=messages, tools=None):
                if kind == "delta":
                    yield {"type": "delta", "text": payload}
                else:
                    msg, usage = payload, chunk_usage
            final_text = (msg.content or "").strip()
            log_ai_event(
                "ai.chat_loop.final",
                tripId=trip.trip_id,
                iteration=iterations,
                capHit=True,
                assistantMessage=final_text,
                **_usage_fields(usage),
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
        refreshed = await trip_summary(db, trip)
        complete = (
            refreshed["staysCount"] > 0
            and refreshed["travelsCount"] > 0
            and bool(trip.destination_location_name)
            and bool(trip.start_date)
            and bool(trip.end_date)
        )
        if complete:
            mark_trip_draft_after_chat_completion(trip)
            verify = verify_trip(await assembled_trip(db, trip))

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

    yield {
        "type": "outcome",
        "outcome": WorkflowOutcome(
            assistantMessage=final_text,
            complete=complete,
            verify=verify,
            structuredContent=structured_content,
        ),
    }


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
    """Drain stream_chat_tool_loop and return just the outcome."""
    outcome: WorkflowOutcome | None = None
    async for event in stream_chat_tool_loop(
        db,
        trip=trip,
        transcript=transcript,
        latest_message=latest_message,
        conversation_summary=conversation_summary,
        ui_context=ui_context,
        workflow_name=workflow_name,
        client=client,
    ):
        if event["type"] == "outcome":
            outcome = event["outcome"]
    assert outcome is not None
    return outcome
