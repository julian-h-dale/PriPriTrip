from __future__ import annotations

from datetime import date
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import ChatMessageRecord, TripRecord, UserRecord
from app.schemas import ChatMessageResponse, ChatReplyRequest, ChatReplyResponse
from app.services.new_trip_workflow import handle_new_trip_chat_turn
from app.services.trip_assistant_workflow import handle_trip_assistant_chat_turn

router = APIRouter(prefix="/chat", tags=["chat"])

_TRANSCRIPT_WINDOW_TURNS = 12


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


@router.get("/trips/{trip_id}", response_model=list[ChatMessageResponse])
async def list_trip_chat_messages(
    trip_id: str,
    workflow_name: str = Query(..., alias="workflowName"),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip = await db.get(TripRecord, trip_id)
    if trip is None or trip.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    result = await db.execute(
        select(ChatMessageRecord)
        .where(
            ChatMessageRecord.trip_id == trip_id,
            ChatMessageRecord.user_id == str(user.id),
            ChatMessageRecord.workflow_name == workflow_name,
        )
        .order_by(ChatMessageRecord.created_at)
    )
    return [_message_to_response(rec) for rec in result.scalars().all()]


@router.post("/reply", response_model=ChatReplyResponse)
async def reply_in_chat(
    body: ChatReplyRequest,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip_id = body.tripId
    if trip_id:
        trip = await db.get(TripRecord, trip_id)
        if trip is None or trip.user_id != str(user.id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    else:
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
        workflow_name=body.workflowName,
        message=body.message.strip(),
        is_bot=False,
    )
    db.add(user_message)
    await db.flush()

    transcript_result = await db.execute(
        select(ChatMessageRecord)
        .where(
            ChatMessageRecord.trip_id == trip_id,
            ChatMessageRecord.user_id == str(user.id),
            ChatMessageRecord.workflow_name == body.workflowName,
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
            ChatMessageRecord.workflow_name == _summary_workflow_name(body.workflowName),
            ChatMessageRecord.is_bot.is_(True),
        )
        .order_by(ChatMessageRecord.created_at.desc())
    )
    latest_summary = next(iter(summary_result.scalars().all()), None)
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
                workflow_name=_summary_workflow_name(body.workflowName),
                message=conversation_summary,
                structure_content=json.dumps({"coveredTurns": desired_covered_turns}),
                is_bot=True,
            )
        )
        await db.flush()

    if body.workflowName == "trip:new_trip":
        outcome = await handle_new_trip_chat_turn(
            db,
            trip=trip,
            transcript=transcript,
            latest_message=body.message.strip(),
            conversation_summary=conversation_summary or None,
            ui_context=body.context,
        )
        bot_text = outcome.assistantMessage
        complete = outcome.complete
        verify = outcome.verify
        structure_content = json.dumps(outcome.structuredContent) if outcome.structuredContent else None
    elif body.workflowName.startswith("trip:"):
        outcome = await handle_trip_assistant_chat_turn(
            db,
            trip=trip,
            transcript=transcript,
            latest_message=body.message.strip(),
            conversation_summary=conversation_summary or None,
            ui_context=body.context,
        )
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
        workflow_name=body.workflowName,
        message=bot_text,
        structure_content=structure_content,
        is_bot=True,
    )
    db.add(bot_message)
    await db.commit()
    await db.refresh(user_message)
    await db.refresh(bot_message)

    return ChatReplyResponse(
        tripId=trip_id,
        complete=complete,
        tripName=trip.trip_name,
        verify=verify,
        messages=[_message_to_response(user_message), _message_to_response(bot_message)],
    )
