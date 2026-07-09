from __future__ import annotations

from datetime import date, datetime, timezone
import json
import os
import time
import uuid
from typing import Optional

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LocationRecord, StayDetailRecord, TravelDetailRecord, TripDayRecord, TripPointRecord, TripRecord
from app.schemas import StayDetailImport, TravelDetailImport, TripResponse, VerifyResult
from app.serializers import point_to_response, stay_to_response, travel_to_response
from app.services.ai_trace import log_ai_event
from app.services.detail_points import (
    CHECK_IN_DEFAULT_TIME,
    CHECK_OUT_DEFAULT_TIME,
    normalize_stay_wall_clock,
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services.prompt_composer import build_new_trip_stage_prompt
from app.services.timezones import derive_utc, parse_wall_clock, tzid_from_coords, wall_clock_to_text
from app.services.trip_verify import verify_trip

_DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4")
_REQUEST_TIMEOUT = float(os.environ.get("OPENAI_TIMEOUT", "120"))
_MAX_RETRIES = int(os.environ.get("OPENAI_MAX_RETRIES", "2"))

class WelcomeTurn(BaseModel):
    assistantMessage: str
    tripName: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    startLocationName: Optional[str] = None
    destinationLocationName: Optional[str] = None
    defaultTimezoneId: Optional[str] = None


class TravelTurn(BaseModel):
    assistantMessage: str
    travel: Optional[TravelDetailImport] = None


class StayTurn(BaseModel):
    assistantMessage: str
    stay: Optional[StayDetailImport] = None


class WorkflowOutcome(BaseModel):
    assistantMessage: str
    complete: bool = False
    verify: Optional[VerifyResult] = None
    structuredContent: Optional[dict] = None


def _structured_turn_payload(model: BaseModel) -> dict:
    data = model.model_dump(exclude_none=True)
    data.pop("assistantMessage", None)
    return data


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
        "ai.new_trip.openai.request",
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
            "ai.new_trip.openai.error",
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
    log_ai_event(
        "ai.new_trip.openai.response_meta",
        passName=pass_name,
        elapsedSeconds=round(time.monotonic() - started, 3),
        finishReason=(completion.choices[0].finish_reason if completion.choices else None),
        usage=(getattr(usage, "total_tokens", None) if usage else None),
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
        "ai.new_trip.openai.parsed",
        passName=pass_name,
        parsed=parsed,
    )
    return parsed


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
        "Current trip state:\n"
        f"{json.dumps(summary, indent=2)}\n\n"
        "Current full trip snapshot:\n"
        f"{json.dumps(trip_snapshot, indent=2)}\n\n"
        "Conversation summary of older turns (if any):\n"
        f"{conversation_summary or ''}\n\n"
        "Conversation so far:\n"
        f"{json.dumps(transcript, indent=2)}\n\n"
        "UI context (if any):\n"
        f"{json.dumps(ui_context or {}, indent=2)}\n\n"
        "Latest user message:\n"
        f"{latest_message}"
    )


def _is_shell_trip(trip: TripRecord) -> bool:
    return trip.trip_name == "New Trip Draft" and trip.start_date == trip.end_date


async def _reconcile_trip_days(db: AsyncSession, trip: TripRecord) -> None:
    try:
        start = date.fromisoformat(trip.start_date)
        end = date.fromisoformat(trip.end_date)
    except ValueError:
        return
    if end < start:
        return

    existing_result = await db.execute(
        select(TripDayRecord).where(
            TripDayRecord.trip_id == trip.trip_id,
            TripDayRecord.is_deleted.is_(False),
            TripDayRecord.deleted_at.is_(None),
        )
    )
    existing_days = existing_result.scalars().all()
    existing_by_date = {day.date: day for day in existing_days}

    current = start
    desired_dates = set()
    while current <= end:
        date_text = current.isoformat()
        desired_dates.add(date_text)
        if date_text not in existing_by_date:
            db.add(
                TripDayRecord(
                    day_id=str(uuid.uuid4()),
                    trip_id=trip.trip_id,
                    title=date_text,
                    date=date_text,
                    description=None,
                    is_alternate=False,
                    completed=False,
                )
            )
        current = current.fromordinal(current.toordinal() + 1)

    if existing_days:
        points_result = await db.execute(
            select(TripPointRecord).where(
                TripPointRecord.trip_id == trip.trip_id,
                TripPointRecord.is_deleted.is_(False),
                TripPointRecord.deleted_at.is_(None),
            )
        )
        points_by_day: dict[str, list[TripPointRecord]] = {}
        for point in points_result.scalars().all():
            points_by_day.setdefault(point.day_id, []).append(point)

        for day in existing_days:
            if day.date in desired_dates:
                continue
            if points_by_day.get(day.day_id):
                continue
            day.is_deleted = True
            day.deleted_at = datetime.now(timezone.utc)
            day.updated_at = datetime.now(timezone.utc)

    await db.flush()


async def _apply_welcome_updates(db: AsyncSession, trip: TripRecord, turn: WelcomeTurn) -> None:
    if turn.tripName:
        trip.trip_name = turn.tripName
    if turn.startLocationName:
        trip.start_location_name = turn.startLocationName
    if turn.destinationLocationName:
        trip.destination_location_name = turn.destinationLocationName
    if turn.defaultTimezoneId:
        trip.default_timezone_id = turn.defaultTimezoneId
    if turn.startDate:
        trip.start_date = turn.startDate
    if turn.endDate:
        trip.end_date = turn.endDate
    if trip.trip_name == "New Trip Draft" and trip.destination_location_name:
        trip.trip_name = f"{trip.destination_location_name} Trip"
    await _reconcile_trip_days(db, trip)


def _mark_trip_draft_after_chat_completion(trip: TripRecord) -> None:
    # Completing the chat-driven new-trip flow moves the trip out of "new"
    # so itinerary uploads are no longer allowed.
    if trip.status != "draft":
        trip.status = "draft"
        trip.updated_at = datetime.now(timezone.utc)


async def _create_travel(db: AsyncSession, trip: TripRecord, travel: TravelDetailImport) -> None:
    detail_id = travel.travelDetailId or str(uuid.uuid4())
    departure_tzid = travel.departureTimezoneId or trip.default_timezone_id
    arrival_tzid = travel.arrivalTimezoneId or trip.default_timezone_id
    departure_local = parse_wall_clock(travel.departureDateTime)
    arrival_local = parse_wall_clock(travel.arrivalDateTime)
    rec = TravelDetailRecord(
        travel_detail_id=detail_id,
        trip_id=trip.trip_id,
        name=travel.name,
        mode=travel.mode,
        operator=travel.operator,
        vehicle_number=travel.vehicleNumber,
        cabin_class=travel.cabinClass,
        departure_local=departure_local,
        departure_tzid=departure_tzid,
        departure_utc=derive_utc(departure_local, departure_tzid),
        arrival_local=arrival_local,
        arrival_tzid=arrival_tzid,
        arrival_utc=derive_utc(arrival_local, arrival_tzid),
        departure_date_time=wall_clock_to_text(departure_local),
        arrival_date_time=wall_clock_to_text(arrival_local),
        confirmation_number=travel.confirmationNumber,
        description=travel.description,
    )
    db.add(rec)
    await db.flush()
    for idx, loc in enumerate(travel.locations or []):
        db.add(
            LocationRecord(
                location_id=loc.locationId,
                point_id=None,
                stay_detail_id=None,
                travel_detail_id=detail_id,
                role=loc.role,
                sort_order=idx,
                name=loc.name,
                lat=loc.lat,
                lng=loc.lng,
                full_address=loc.fullAddress,
                description=loc.description,
                link=loc.link,
                google_place_id=loc.googlePlaceId,
                google_maps_uri=loc.googleMapsUri,
                timezone_id=loc.timezoneId or tzid_from_coords(loc.lat, loc.lng),
            )
        )
    await sync_travel_generated_points(db, travel=rec)


async def _create_stay(db: AsyncSession, trip: TripRecord, stay: StayDetailImport) -> None:
    detail_id = stay.stayDetailId or str(uuid.uuid4())
    check_in_text = normalize_stay_wall_clock(stay.checkIn, default_time=CHECK_IN_DEFAULT_TIME)
    check_out_text = normalize_stay_wall_clock(stay.checkOut, default_time=CHECK_OUT_DEFAULT_TIME)
    check_in_tzid = stay.checkInTimezoneId or trip.default_timezone_id
    check_out_tzid = stay.checkOutTimezoneId or check_in_tzid
    check_in_local = parse_wall_clock(check_in_text)
    check_out_local = parse_wall_clock(check_out_text)
    rec = StayDetailRecord(
        stay_detail_id=detail_id,
        trip_id=trip.trip_id,
        name=stay.name,
        stay_type=stay.stayType,
        check_in_local=check_in_local,
        check_in_tzid=check_in_tzid,
        check_in_utc=derive_utc(check_in_local, check_in_tzid),
        check_out_local=check_out_local,
        check_out_tzid=check_out_tzid,
        check_out_utc=derive_utc(check_out_local, check_out_tzid),
        check_in=wall_clock_to_text(check_in_local),
        check_out=wall_clock_to_text(check_out_local),
        room_type=stay.roomType,
        confirmation_number=stay.confirmationNumber,
        description=stay.description,
    )
    db.add(rec)
    await db.flush()
    for idx, loc in enumerate(stay.locations or []):
        db.add(
            LocationRecord(
                location_id=loc.locationId,
                point_id=None,
                stay_detail_id=detail_id,
                travel_detail_id=None,
                role=loc.role,
                sort_order=idx,
                name=loc.name,
                lat=loc.lat,
                lng=loc.lng,
                full_address=loc.fullAddress,
                description=loc.description,
                link=loc.link,
                google_place_id=loc.googlePlaceId,
                google_maps_uri=loc.googleMapsUri,
                timezone_id=loc.timezoneId or tzid_from_coords(loc.lat, loc.lng),
            )
        )
    await sync_stay_generated_points(db, stay=rec)


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

    stays = {s.stay_detail_id: stay_to_response(s, locs_by_stay.get(s.stay_detail_id, [])) for s in stay_records}
    travels = {t.travel_detail_id: travel_to_response(t, locs_by_travel.get(t.travel_detail_id, [])) for t in travel_records}

    points_by_day: dict[str, list] = {}
    for point in points:
        points_by_day.setdefault(point.day_id, []).append(point)

    from app.schemas import TripDayWithPoints

    days = [
        TripDayWithPoints(
            dayId=day.day_id,
            tripId=day.trip_id,
            title=day.title,
            date=day.date,
            description=day.description,
            isAlternate=day.is_alternate,
            completed=day.completed,
            deletedAt=day.deleted_at.isoformat() if day.deleted_at else None,
            createdAt=day.created_at.isoformat() if day.created_at else None,
            updatedAt=day.updated_at.isoformat() if day.updated_at else None,
            points=[
                point_to_response(
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
        tripId=trip.trip_id,
        tripName=trip.trip_name,
        status=trip.status,
        startLocationName=trip.start_location_name,
        destinationLocationName=trip.destination_location_name,
        defaultTimezoneId=trip.default_timezone_id,
        startDate=trip.start_date,
        endDate=trip.end_date,
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
    client = client or _client()
    summary = await _trip_state_summary(db, trip)
    trip_snapshot = (await _assembled_trip(db, trip)).model_dump(mode="json")
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

    if missing_welcome:
        log_ai_event("ai.new_trip.turn.stage", tripId=trip.trip_id, stage="welcome")
        turn = _parse(
            client,
            system=build_new_trip_stage_prompt("welcome"),
            user=_conversation_prompt(
                summary,
                trip_snapshot,
                transcript,
                latest_message,
                conversation_summary,
                ui_context,
            ),
            response_format=WelcomeTurn,
            pass_name="new-trip-welcome",
        )
        await _apply_welcome_updates(db, trip, turn)
        log_ai_event(
            "ai.new_trip.turn.outcome",
            tripId=trip.trip_id,
            stage="welcome",
            complete=False,
            structured=_structured_turn_payload(turn),
            assistantMessage=turn.assistantMessage,
        )
        return WorkflowOutcome(
            assistantMessage=turn.assistantMessage,
            complete=False,
            structuredContent=_structured_turn_payload(turn),
        )

    if active_travels == 0:
        log_ai_event("ai.new_trip.turn.stage", tripId=trip.trip_id, stage="travel")
        turn = _parse(
            client,
            system=build_new_trip_stage_prompt("travel"),
            user=_conversation_prompt(
                summary,
                trip_snapshot,
                transcript,
                latest_message,
                conversation_summary,
                ui_context,
            ),
            response_format=TravelTurn,
            pass_name="new-trip-travel",
        )
        if turn.travel is not None:
            await _create_travel(db, trip, turn.travel)
            log_ai_event(
                "ai.new_trip.turn.travel_created",
                tripId=trip.trip_id,
                travel=turn.travel,
            )
        log_ai_event(
            "ai.new_trip.turn.outcome",
            tripId=trip.trip_id,
            stage="travel",
            complete=False,
            structured=_structured_turn_payload(turn),
            assistantMessage=turn.assistantMessage,
        )
        return WorkflowOutcome(
            assistantMessage=turn.assistantMessage,
            complete=False,
            structuredContent=_structured_turn_payload(turn),
        )

    if active_stays == 0:
        log_ai_event("ai.new_trip.turn.stage", tripId=trip.trip_id, stage="stay")
        turn = _parse(
            client,
            system=build_new_trip_stage_prompt("stay"),
            user=_conversation_prompt(
                summary,
                trip_snapshot,
                transcript,
                latest_message,
                conversation_summary,
                ui_context,
            ),
            response_format=StayTurn,
            pass_name="new-trip-stay",
        )
        if turn.stay is not None:
            await _create_stay(db, trip, turn.stay)
            _mark_trip_draft_after_chat_completion(trip)
            assembled = await _assembled_trip(db, trip)
            verify = verify_trip(assembled)
            summary_message = (
                f"Your trip draft is ready: {assembled.tripName}.\n"
                f"- dates: {assembled.startDate} to {assembled.endDate}\n"
                f"- travel legs: {len(assembled.travels)}\n"
                f"- stays: {len(assembled.stays)}\n"
                "Opening inspection so you can review any remaining issues."
            )
            log_ai_event(
                "ai.new_trip.turn.outcome",
                tripId=trip.trip_id,
                stage="stay",
                complete=True,
                verify=verify,
                structured=_structured_turn_payload(turn),
                assistantMessage=summary_message,
            )
            return WorkflowOutcome(
                assistantMessage=summary_message,
                complete=True,
                verify=verify,
                structuredContent=_structured_turn_payload(turn),
            )
        log_ai_event(
            "ai.new_trip.turn.outcome",
            tripId=trip.trip_id,
            stage="stay",
            complete=False,
            structured=_structured_turn_payload(turn),
            assistantMessage=turn.assistantMessage,
        )
        return WorkflowOutcome(
            assistantMessage=turn.assistantMessage,
            complete=False,
            structuredContent=_structured_turn_payload(turn),
        )

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
