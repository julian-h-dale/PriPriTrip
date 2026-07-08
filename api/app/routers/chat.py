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

router = APIRouter(prefix="/chat", tags=["chat"])


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
            status="draft",
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
    transcript = [
        {
            "role": "assistant" if rec.is_bot else "user",
            "message": rec.message,
        }
        for rec in transcript_result.scalars().all()
    ]

    if body.workflowName == "trip:new_trip":
        outcome = await handle_new_trip_chat_turn(
            db,
            trip=trip,
            transcript=transcript,
            latest_message=body.message.strip(),
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
