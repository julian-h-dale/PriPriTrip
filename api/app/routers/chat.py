from __future__ import annotations

from datetime import date, datetime, timezone
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.dependencies import get_owned_trip, require_owned_trip
from app.models import ChatMessageRecord, TripRecord, UserRecord
from app.schemas import (
    ChatFormSubmitRequest,
    ChatMessageResponse,
    ChatReplyRequest,
    ChatReplyResponse,
)
from app.services.ai_trace import log_ai_event
from app.services.chat_forms import FormError, describe_submission, validate_submission
from app.services.chat_tool_loop import stream_chat_tool_loop
from app.services.llm_contract import (
    AssistantAction,
    AssistantActionFields,
    AssistantRuntimeContext,
    UserHomeLocationContext,
)
from app.services.trip_action_executor import execute_action
from app.services.trip_state import assembled_trip
from app.services.trip_verify import verify_trip

router = APIRouter(prefix="/chat", tags=["chat"])

_TRANSCRIPT_WINDOW_TURNS = 12
_GENERIC_STREAM_ERROR = "The AI service request failed. Please try again."


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


def _summary_workflow_name(workflow_name: str) -> str:
    return f"{workflow_name}::summary"


def _safe_json_dict(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _build_transcript_window(messages: list[ChatMessageRecord]) -> tuple[list[dict], list[ChatMessageRecord]]:
    if len(messages) <= _TRANSCRIPT_WINDOW_TURNS:
        return [
            {
                "role": "assistant" if rec.is_bot else "user",
                "message": rec.message,
            }
            for rec in messages
        ], []
    older = messages[:-_TRANSCRIPT_WINDOW_TURNS]
    window = messages[-_TRANSCRIPT_WINDOW_TURNS:]
    return [
        {
            "role": "assistant" if rec.is_bot else "user",
            "message": rec.message,
        }
        for rec in window
    ], older


def _compact_messages_for_summary(messages: list[ChatMessageRecord]) -> str:
    lines: list[str] = []
    for rec in messages:
        role = "Assistant" if rec.is_bot else "User"
        text = " ".join((rec.message or "").strip().split())
        if not text:
            continue
        if len(text) > 180:
            text = f"{text[:177]}..."
        lines.append(f"- {role}: {text}")
    return "\n".join(lines)


def _merge_rolling_summary(existing_summary: str | None, delta_messages: list[ChatMessageRecord]) -> str:
    delta = _compact_messages_for_summary(delta_messages)
    if not existing_summary:
        return delta
    if not delta:
        return existing_summary
    merged = f"{existing_summary}\n{delta}".strip()
    # Keep the rolling summary bounded so it remains useful and cheap.
    lines = [line for line in merged.splitlines() if line.strip()]
    if len(lines) > 80:
        lines = lines[-80:]
    return "\n".join(lines)


def _message_to_response(rec: ChatMessageRecord) -> ChatMessageResponse:
    return ChatMessageResponse(
        messageId=rec.message_id,
        tripId=rec.trip_id,
        workflowName=rec.workflow_name,
        message=rec.message,
        structureContent=rec.structure_content,
        isBot=rec.is_bot,
        createdAt=rec.created_at.isoformat() if rec.created_at else None,
    )


def _safe_str(value) -> str | None:
    return value if isinstance(value, str) else None


def _safe_float(value) -> float | None:
    return value if isinstance(value, (float, int)) else None


def _app_current_date(user: UserRecord) -> str:
    """Today's date in the user's home timezone (fallback UTC)."""
    from zoneinfo import ZoneInfo

    tzid = _safe_str(getattr(user, "home_timezone_id", None))
    try:
        tz = ZoneInfo(tzid) if tzid else timezone.utc
    except Exception:
        tz = timezone.utc
    return datetime.now(tz).date().isoformat()


def _runtime_context_for_user(user: UserRecord, ui_context: dict | None) -> dict:
    ctx = AssistantRuntimeContext(
        appCurrentDate=_app_current_date(user),
        userHomeLocation=UserHomeLocationContext(
            name=_safe_str(getattr(user, "home_location_name", None)),
            fullAddress=_safe_str(getattr(user, "home_location_full_address", None)),
            lat=_safe_float(getattr(user, "home_location_lat", None)),
            lng=_safe_float(getattr(user, "home_location_lng", None)),
            googlePlaceId=_safe_str(getattr(user, "home_location_google_place_id", None)),
            googleMapsUri=_safe_str(getattr(user, "home_location_google_maps_uri", None)),
        ),
        userHomeTimezoneId=_safe_str(getattr(user, "home_timezone_id", None)),
        uiContext=ui_context or {},
    )
    return ctx.model_dump(mode="json")


@router.get("/trips/{trip_id}", response_model=list[ChatMessageResponse])
async def list_trip_chat_messages(
    workflow_name: str = Query(..., alias="workflowName"),
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    result = await db.execute(
        select(ChatMessageRecord)
        .where(
            ChatMessageRecord.trip_id == trip.trip_id,
            ChatMessageRecord.user_id == str(user.id),
            ChatMessageRecord.workflow_name == workflow_name,
        )
        .order_by(ChatMessageRecord.created_at)
    )
    return [_message_to_response(rec) for rec in result.scalars().all()]


async def _stored_reply(db: AsyncSession, *, user: UserRecord, request_id: str) -> dict | None:
    """The reply a previous identical send already produced, if any."""
    result = await db.execute(
        select(ChatMessageRecord).where(
            ChatMessageRecord.user_id == str(user.id),
            ChatMessageRecord.request_id == request_id,
            ChatMessageRecord.is_bot.is_(True),
        )
    )
    bot_message = result.scalar_one_or_none()
    if bot_message is None or not bot_message.reply_payload:
        return None
    return _safe_json_dict(bot_message.reply_payload) or None


def _replay_response(payload: dict, *, request_id: str, workflow_name: str) -> StreamingResponse:
    log_ai_event(
        "chat.reply.replayed",
        workflowName=workflow_name,
        requestId=request_id,
        tripId=payload.get("tripId"),
    )

    async def stream():
        yield _sse("done", payload)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/reply")
async def reply_in_chat(
    body: ChatReplyRequest,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip_id = body.trip_id
    request_id = body.request_id
    runtime_context = _runtime_context_for_user(user, body.context)
    # Verify ownership BEFORE logging: messages aimed at other users' trips
    # must not reach ai.log (review.md 1C-7).
    if trip_id:
        trip = await require_owned_trip(db, trip_id, user)

    # Idempotency (review.md 3D-5): a repeat of a send we already answered
    # replays that answer — no second LLM call, no duplicate stays/travels.
    replay = await _stored_reply(db, user=user, request_id=request_id)
    if replay is not None:
        return _replay_response(replay, request_id=request_id, workflow_name=body.workflow_name)

    log_ai_event(
        "chat.reply.received",
        workflowName=body.workflow_name,
        tripId=trip_id,
        requestId=request_id,
        message=body.message.strip(),
        uiContext=body.context,
        runtimeContext=runtime_context,
    )
    if not trip_id:
        today = date.today().isoformat()
        trip_id = str(uuid.uuid4())
        trip = TripRecord(
            trip_id=trip_id,
            user_id=str(user.id),
            trip_name="New Trip Draft",
            start_date=today,
            end_date=today,
            status="new",
        )
        db.add(trip)
        await db.flush()

    user_message = ChatMessageRecord(
        message_id=str(uuid.uuid4()),
        user_id=str(user.id),
        trip_id=trip_id,
        workflow_name=body.workflow_name,
        message=body.message.strip(),
        is_bot=False,
        request_id=request_id,
    )
    db.add(user_message)
    try:
        # Claims the request id. A concurrent duplicate blocks here until this
        # transaction ends, then fails the unique constraint — so the pipeline
        # only ever runs once, even for simultaneous sends.
        await db.flush()
    except IntegrityError:
        await db.rollback()
        replay = await _stored_reply(db, user=user, request_id=request_id)
        if replay is not None:
            return _replay_response(replay, request_id=request_id, workflow_name=body.workflow_name)
        # The winner rolled back (its turn failed), so nothing was persisted.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A request with this id is already being processed.",
        )

    transcript_result = await db.execute(
        select(ChatMessageRecord)
        .where(
            ChatMessageRecord.trip_id == trip_id,
            ChatMessageRecord.user_id == str(user.id),
            ChatMessageRecord.workflow_name == body.workflow_name,
        )
        .order_by(ChatMessageRecord.created_at)
    )
    workflow_messages = transcript_result.scalars().all()
    transcript, older_messages = _build_transcript_window(workflow_messages)

    summary_result = await db.execute(
        select(ChatMessageRecord)
        .where(
            ChatMessageRecord.trip_id == trip_id,
            ChatMessageRecord.user_id == str(user.id),
            ChatMessageRecord.workflow_name == _summary_workflow_name(body.workflow_name),
            ChatMessageRecord.is_bot.is_(True),
        )
        .order_by(ChatMessageRecord.created_at.desc())
        .limit(1)
    )
    latest_summary = summary_result.scalar_one_or_none()
    summary_meta = _safe_json_dict(latest_summary.structure_content if latest_summary else None)
    covered_turns = int(summary_meta.get("coveredTurns", 0))
    existing_summary = latest_summary.message if latest_summary else ""

    desired_covered_turns = len(older_messages)
    conversation_summary = existing_summary
    if desired_covered_turns > covered_turns:
        delta_messages = older_messages[covered_turns:desired_covered_turns]
        conversation_summary = _merge_rolling_summary(existing_summary, delta_messages)
        db.add(
            ChatMessageRecord(
                message_id=str(uuid.uuid4()),
                user_id=str(user.id),
                trip_id=trip_id,
                workflow_name=_summary_workflow_name(body.workflow_name),
                message=conversation_summary,
                structure_content=json.dumps({"coveredTurns": desired_covered_turns}),
                is_bot=True,
            )
        )
        await db.flush()

    log_ai_event(
        "chat.reply.context",
        workflowName=body.workflow_name,
        tripId=trip_id,
        totalWorkflowMessages=len(workflow_messages),
        transcriptWindowTurns=len(transcript),
        olderTurnCount=len(older_messages),
        coveredTurns=covered_turns,
        summaryCoveredTurns=desired_covered_turns,
        conversationSummary=conversation_summary,
        runtimeContext=runtime_context,
    )

    async def event_stream():
        # Runs while the SSE response streams; the get_db session stays open
        # until this generator finishes. Nothing is committed on failure —
        # the turn (including the user message) is discarded, same as the
        # pre-streaming behavior on an exception.
        try:
            if body.workflow_name.startswith("trip:"):
                # Tool-calling loop (review.md 3A): one runner for all trip:*
                # chat workflows.
                outcome = None
                async for event in stream_chat_tool_loop(
                    db,
                    trip=trip,
                    transcript=transcript,
                    latest_message=body.message.strip(),
                    conversation_summary=conversation_summary or None,
                    ui_context=runtime_context,
                    workflow_name=body.workflow_name,
                ):
                    if event["type"] == "delta":
                        yield _sse("delta", {"text": event["text"]})
                    elif event["type"] == "status":
                        yield _sse("status", {"tool": event["tool"], "label": event["label"]})
                    else:
                        outcome = event["outcome"]
                bot_text = outcome.assistantMessage
                complete = outcome.complete
                verify = outcome.verify
                structure_content = json.dumps(outcome.structuredContent) if outcome.structuredContent else None
            else:
                bot_text = f"Hello world - {date.today().isoformat()}"
                complete = False
                verify = None
                structure_content = None

            bot_message = ChatMessageRecord(
                message_id=str(uuid.uuid4()),
                user_id=str(user.id),
                trip_id=trip_id,
                workflow_name=body.workflow_name,
                message=bot_text,
                structure_content=structure_content,
                is_bot=True,
                request_id=request_id,
            )
            db.add(bot_message)
            await db.flush()
            await db.refresh(user_message)
            await db.refresh(bot_message)

            log_ai_event(
                "chat.reply.outcome",
                workflowName=body.workflow_name,
                tripId=trip_id,
                requestId=request_id,
                complete=complete,
                verify=verify.model_dump(mode="json") if verify else None,
                structuredContent=json.loads(structure_content) if structure_content else None,
                botMessage=bot_text,
            )

            response = ChatReplyResponse(
                tripId=trip_id,
                complete=complete,
                tripName=trip.trip_name,
                verify=verify,
                messages=[_message_to_response(user_message), _message_to_response(bot_message)],
            )
            payload = response.model_dump(mode="json", by_alias=True)
            # Stored so a repeat of this request id replays the exact same
            # answer instead of recomputing it (review.md 3D-5).
            bot_message.reply_payload = json.dumps(payload)
            await db.commit()

            yield _sse("done", payload)
        except HTTPException as exc:
            # Already logged at the source (e.g. ai.chat_loop.error). The SSE
            # response is committed to 200 by now, so errors ride the stream.
            yield _sse("error", {"detail": exc.detail})
        except Exception as exc:
            log_ai_event(
                "chat.reply.error",
                workflowName=body.workflow_name,
                tripId=trip_id,
                error=str(exc),
            )
            yield _sse("error", {"detail": _GENERIC_STREAM_ERROR})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/forms/submit", response_model=ChatReplyResponse)
async def submit_chat_form(
    body: ChatFormSubmitRequest,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    """Apply a filled-in chat form (review.md 3F-2).

    Deliberately *not* a chat turn: the values go straight through the executor,
    so a plain save costs no model call and is instant. The exchange is still
    recorded in the transcript so the assistant has the context next turn.
    """
    trip = await require_owned_trip(db, body.trip_id, user)

    replay = await _stored_reply(db, user=user, request_id=body.request_id)
    if replay is not None:
        return ChatReplyResponse.model_validate(replay)

    try:
        values = validate_submission(body.target, body.values)
    except FormError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    action = AssistantAction(
        op="update" if (body.record_id or body.target == "trip") else "create",
        target=body.target,
        id=body.record_id if body.target != "trip" else None,
        fields=AssistantActionFields.model_validate(values),
    )

    log_ai_event(
        "chat.form.submitted",
        workflowName=body.workflow_name,
        tripId=body.trip_id,
        requestId=body.request_id,
        formId=body.form_id,
        target=body.target,
        recordId=body.record_id,
        values=values,
    )

    result = await execute_action(db, trip=trip, action=action)
    if result.status != "ok":
        # Nothing is persisted; the user keeps the form and can correct it.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=result.detail or "Those details could not be saved.",
        )

    filled = describe_submission(body.target, values)
    user_message = ChatMessageRecord(
        message_id=str(uuid.uuid4()),
        user_id=str(user.id),
        trip_id=body.trip_id,
        workflow_name=body.workflow_name,
        message=f"[form] {filled}",
        is_bot=False,
        request_id=body.request_id,
    )
    db.add(user_message)

    verify = verify_trip(await assembled_trip(db, trip))
    # Terse on purpose: the user's own message already carries the values, so
    # repeating them here would print them twice in a row in the transcript.
    saved_noun = {"point": "activity"}.get(body.target, body.target)
    bot_message = ChatMessageRecord(
        message_id=str(uuid.uuid4()),
        user_id=str(user.id),
        trip_id=body.trip_id,
        workflow_name=body.workflow_name,
        message=f"Saved the {saved_noun} details.",
        structure_content=json.dumps(
            {
                "formSubmission": {
                    "formId": body.form_id,
                    "target": body.target,
                    "recordId": result.id,
                    "values": values,
                },
                "results": [result.model_dump(mode="json")],
            }
        ),
        is_bot=True,
        request_id=body.request_id,
    )
    db.add(bot_message)
    await db.flush()
    await db.refresh(user_message)
    await db.refresh(bot_message)

    response = ChatReplyResponse(
        tripId=body.trip_id,
        complete=False,
        tripName=trip.trip_name,
        verify=verify,
        messages=[_message_to_response(user_message), _message_to_response(bot_message)],
    )
    bot_message.reply_payload = json.dumps(response.model_dump(mode="json", by_alias=True))
    await db.commit()

    log_ai_event(
        "chat.form.saved",
        tripId=body.trip_id,
        formId=body.form_id,
        target=body.target,
        recordId=result.id,
        verify=verify.model_dump(mode="json") if verify else None,
    )
    return response
