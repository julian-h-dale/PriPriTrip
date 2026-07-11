from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LocationRecord, StayDetailRecord, TravelDetailRecord, TripDayRecord, TripPointRecord, TripRecord
from app.schemas import StayDetail, TravelDetail, TripPointResponse, TripResponse, VerifyResult
from app.services.ai_trace import log_ai_event
from app.services.llm_contract import AssistantTurn
from app.services.openai_client import get_async_client, parse_structured
from app.services.prompt_composer import build_new_trip_stage_prompt
from app.services.trip_action_executor import apply_assistant_turn
from app.services.trip_verify import verify_trip


class WorkflowOutcome(BaseModel):
    assistantMessage: str
    complete: bool = False
    verify: Optional[VerifyResult] = None
    structuredContent: Optional[dict] = None


async def _trip_state_summary(db: AsyncSession, trip: TripRecord) -> dict:
    stays_result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip.trip_id,
            StayDetailRecord.is_deleted.is_(False),
            StayDetailRecord.deleted_at.is_(None),
        )
    )
    travels_result = await db.execute(
        select(TravelDetailRecord).where(
            TravelDetailRecord.trip_id == trip.trip_id,
            TravelDetailRecord.is_deleted.is_(False),
            TravelDetailRecord.deleted_at.is_(None),
        )
    )
    return {
        "tripId": trip.trip_id,
        "tripName": trip.trip_name,
        "startLocationName": trip.start_location_name,
        "destinationLocationName": trip.destination_location_name,
        "defaultTimezoneId": trip.default_timezone_id,
        "startDate": trip.start_date,
        "endDate": trip.end_date,
        "staysCount": len(stays_result.scalars().all()),
        "travelsCount": len(travels_result.scalars().all()),
    }


def _conversation_prompt(
    summary: dict,
    trip_snapshot: dict,
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


def _is_shell_trip(trip: TripRecord) -> bool:
    return trip.trip_name == "New Trip Draft" and trip.start_date == trip.end_date


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


def _mark_trip_draft_after_chat_completion(trip: TripRecord) -> None:
    # Completing the chat-driven new-trip flow moves the trip out of "new"
    # so itinerary uploads are no longer allowed.
    if trip.status != "draft":
        trip.status = "draft"
        trip.updated_at = datetime.now(timezone.utc)


async def _assembled_trip(db: AsyncSession, trip: TripRecord) -> TripResponse:
    stay_records = (
        await db.execute(
            select(StayDetailRecord).where(
                StayDetailRecord.trip_id == trip.trip_id,
                StayDetailRecord.is_deleted.is_(False),
                StayDetailRecord.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    travel_records = (
        await db.execute(
            select(TravelDetailRecord).where(
                TravelDetailRecord.trip_id == trip.trip_id,
                TravelDetailRecord.is_deleted.is_(False),
                TravelDetailRecord.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    day_records = (
        await db.execute(
            select(TripDayRecord).where(
                TripDayRecord.trip_id == trip.trip_id,
                TripDayRecord.is_deleted.is_(False),
                TripDayRecord.deleted_at.is_(None),
            )
        )
    ).scalars().all()

    locs_by_stay: dict[str, list] = {}
    locs_by_travel: dict[str, list] = {}
    locs_by_point: dict[str, list] = {}

    for loc in (
        await db.execute(select(LocationRecord).where(LocationRecord.stay_detail_id.in_([s.stay_detail_id for s in stay_records])))
    ).scalars().all() if stay_records else []:
        locs_by_stay.setdefault(loc.stay_detail_id, []).append(loc)
    for loc in (
        await db.execute(select(LocationRecord).where(LocationRecord.travel_detail_id.in_([t.travel_detail_id for t in travel_records])))
    ).scalars().all() if travel_records else []:
        locs_by_travel.setdefault(loc.travel_detail_id, []).append(loc)

    points = (
        await db.execute(
            select(TripPointRecord).where(
                TripPointRecord.trip_id == trip.trip_id,
                TripPointRecord.is_deleted.is_(False),
                TripPointRecord.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    if points:
        for loc in (
            await db.execute(select(LocationRecord).where(LocationRecord.point_id.in_([p.point_id for p in points])))
        ).scalars().all():
            locs_by_point.setdefault(loc.point_id, []).append(loc)

    stays = {s.stay_detail_id: StayDetail.from_record(s, locs_by_stay.get(s.stay_detail_id, [])) for s in stay_records}
    travels = {t.travel_detail_id: TravelDetail.from_record(t, locs_by_travel.get(t.travel_detail_id, [])) for t in travel_records}

    points_by_day: dict[str, list] = {}
    for point in points:
        points_by_day.setdefault(point.day_id, []).append(point)

    from app.schemas import TripDayWithPoints

    days = [
        TripDayWithPoints.from_record(
            day,
            points=[
                TripPointResponse.from_record(
                    point,
                    locs_by_point.get(point.point_id, []),
                    travels.get(point.travel_detail_id) if point.travel_detail_id else None,
                    stays.get(point.stay_detail_id) if point.stay_detail_id else None,
                )
                for point in points_by_day.get(day.day_id, [])
            ],
        )
        for day in sorted(day_records, key=lambda item: item.date)
    ]

    return TripResponse(
        trip_id=trip.trip_id,
        trip_name=trip.trip_name,
        status=trip.status,
        start_location_name=trip.start_location_name,
        destination_location_name=trip.destination_location_name,
        default_timezone_id=trip.default_timezone_id,
        start_date=trip.start_date,
        end_date=trip.end_date,
        stays=list(stays.values()),
        travels=list(travels.values()),
        days=days,
    )


async def handle_new_trip_chat_turn(
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
    summary = await _trip_state_summary(db, trip)
    trip_snapshot = (await _assembled_trip(db, trip)).model_dump(mode="json", by_alias=True)
    log_ai_event(
        "ai.new_trip.turn.start",
        tripId=trip.trip_id,
        tripStatus=trip.status,
        summary=summary,
        tripSnapshot=trip_snapshot,
        transcript=transcript,
        latestMessage=latest_message,
        conversationSummary=conversation_summary,
        uiContext=ui_context,
    )

    active_stays = summary["staysCount"]
    active_travels = summary["travelsCount"]
    missing_welcome = (
        _is_shell_trip(trip)
        or not trip.start_location_name
        or not trip.destination_location_name
        or not trip.start_date
        or not trip.end_date
    )

    stage = "welcome" if missing_welcome else ("travel" if active_travels == 0 else ("stay" if active_stays == 0 else "already_complete"))

    if stage == "already_complete":
        assembled = await _assembled_trip(db, trip)
        _mark_trip_draft_after_chat_completion(trip)
        verify = verify_trip(assembled)
        log_ai_event(
            "ai.new_trip.turn.outcome",
            tripId=trip.trip_id,
            stage="already_complete",
            complete=True,
            verify=verify,
            assistantMessage="Your trip already has the key pieces in place. Opening inspection now.",
        )
        return WorkflowOutcome(
            assistantMessage="Your trip already has the key pieces in place. Opening inspection now.",
            complete=True,
            verify=verify,
            structuredContent={"status": "already-complete"},
        )

    log_ai_event("ai.new_trip.turn.stage", tripId=trip.trip_id, stage=stage)
    turn = await parse_structured(
        client,
        system=build_new_trip_stage_prompt(stage),
        user=_conversation_prompt(
            summary,
            trip_snapshot,
            transcript,
            latest_message,
            conversation_summary,
            ui_context,
        ),
        response_format=AssistantTurn,
        pass_name=f"new-trip-{stage}",
        event_prefix="ai.new_trip.openai",
    )

    applied = await apply_assistant_turn(
        db,
        trip=trip,
        turn=turn,
        latest_message=latest_message,
        recent_assistant_questions=_recent_assistant_questions(transcript),
    )

    refreshed_summary = await _trip_state_summary(db, trip)
    complete_now = (
        refreshed_summary["staysCount"] > 0
        and refreshed_summary["travelsCount"] > 0
        and bool(trip.destination_location_name)
        and bool(trip.start_date)
        and bool(trip.end_date)
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
        "stage": stage,
    }

    assistant_text = applied.assistantMessage
    if applied.followUpQuestion:
        assistant_text = f"{assistant_text}\n\n{applied.followUpQuestion}".strip()

    if complete_now:
        _mark_trip_draft_after_chat_completion(trip)
        assembled = await _assembled_trip(db, trip)
        verify = verify_trip(assembled)
        summary_message = (
            f"Your trip draft is ready: {assembled.trip_name}.\n"
            f"- dates: {assembled.start_date} to {assembled.end_date}\n"
            f"- travel legs: {len(assembled.travels)}\n"
            f"- stays: {len(assembled.stays)}\n"
            "Opening inspection so you can review any remaining issues."
        )
        # Don't swallow the model's follow-up question when the trip shell
        # completes — losing it costs real information (review.md 3C-5).
        if applied.followUpQuestion:
            summary_message = f"{summary_message}\n\n{applied.followUpQuestion}"
        log_ai_event(
            "ai.new_trip.turn.outcome",
            tripId=trip.trip_id,
            stage=stage,
            complete=True,
            verify=verify,
            structured=payload,
            assistantMessage=summary_message,
        )
        return WorkflowOutcome(
            assistantMessage=summary_message,
            complete=True,
            verify=verify,
            structuredContent=payload,
        )

    log_ai_event(
        "ai.new_trip.turn.outcome",
        tripId=trip.trip_id,
        stage=stage,
        complete=False,
        structured=payload,
        assistantMessage=assistant_text,
    )
    return WorkflowOutcome(
        assistantMessage=assistant_text,
        complete=False,
        structuredContent=payload,
    )
