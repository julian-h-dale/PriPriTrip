from __future__ import annotations

from datetime import date, datetime, timezone
import uuid
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
)
from app.schemas import (
    StayDetailImport,
    StayDetailPatch,
    TravelDetailImport,
    TravelDetailPatch,
    TripPointCreate,
    TripPointPatch,
)
from app.services.ai_trace import log_ai_event
from app.services.date_normalizer import DateNormalizerInput, normalize_date
from app.services.detail_points import (
    soft_delete_generated_points_for_stay,
    soft_delete_generated_points_for_travel,
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services.llm_contract import ActionResult, AppliedAssistantResult, AssistantAction, AssistantTurn
from app.services.location_resolver import enrich_location_dict
from app.services.timezones import derive_utc, parse_wall_clock, tzid_from_coords, wall_clock_to_text


def _coerce_uuid(value: str | None) -> str:
    if value:
        try:
            return str(uuid.UUID(str(value)))
        except ValueError:
            pass
    return str(uuid.uuid4())


def _trip_tz(trip: TripRecord) -> str:
    return trip.default_timezone_id or "UTC"


def _normalize_trip_dates(fields: dict[str, Any], *, trip: TripRecord) -> dict[str, Any]:
    result = dict(fields)
    today = date.today().isoformat()

    if isinstance(result.get("startDate"), str):
        normalized = normalize_date(
            DateNormalizerInput(
                rawText=result["startDate"],
                appCurrentDate=today,
                tripStartDate=trip.start_date,
                tripEndDate=trip.end_date,
            )
        )
        if normalized:
            result["startDate"] = normalized

    if isinstance(result.get("endDate"), str):
        normalized = normalize_date(
            DateNormalizerInput(
                rawText=result["endDate"],
                appCurrentDate=today,
                tripStartDate=result.get("startDate") or trip.start_date,
                tripEndDate=trip.end_date,
            )
        )
        if normalized:
            result["endDate"] = normalized

    return result


def _ensure_location_id(loc: dict[str, Any]) -> dict[str, Any]:
    loc["locationId"] = _coerce_uuid(loc.get("locationId"))
    return loc


def _prepare_locations(locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for raw_loc in locations:
        loc = _ensure_location_id(dict(raw_loc))
        loc = enrich_location_dict(loc)
        prepared.append(loc)
    return prepared


def _action_fields_dict(action: AssistantAction) -> dict[str, Any]:
    return action.fields.model_dump(mode="json", exclude_none=True)


async def _replace_point_locations(db: AsyncSession, point_id: str, locations: list[dict[str, Any]]) -> None:
    await db.execute(delete(LocationRecord).where(LocationRecord.point_id == point_id))
    for index, loc in enumerate(_prepare_locations(locations)):
        db.add(
            LocationRecord(
                location_id=loc["locationId"],
                point_id=point_id,
                stay_detail_id=None,
                travel_detail_id=None,
                role=loc["role"],
                sort_order=index,
                name=loc["name"],
                lat=loc.get("lat"),
                lng=loc.get("lng"),
                full_address=loc.get("fullAddress"),
                description=loc.get("description"),
                link=loc.get("link"),
                google_place_id=loc.get("googlePlaceId"),
                google_maps_uri=loc.get("googleMapsUri"),
                timezone_id=loc.get("timezoneId") or tzid_from_coords(loc.get("lat"), loc.get("lng")),
            )
        )


async def _replace_detail_locations(
    db: AsyncSession,
    *,
    stay_id: str | None = None,
    travel_id: str | None = None,
    locations: list[dict[str, Any]],
) -> None:
    if stay_id is not None:
        await db.execute(delete(LocationRecord).where(LocationRecord.stay_detail_id == stay_id))
    if travel_id is not None:
        await db.execute(delete(LocationRecord).where(LocationRecord.travel_detail_id == travel_id))

    for index, loc in enumerate(_prepare_locations(locations)):
        db.add(
            LocationRecord(
                location_id=loc["locationId"],
                point_id=None,
                stay_detail_id=stay_id,
                travel_detail_id=travel_id,
                role=loc["role"],
                sort_order=index,
                name=loc["name"],
                lat=loc.get("lat"),
                lng=loc.get("lng"),
                full_address=loc.get("fullAddress"),
                description=loc.get("description"),
                link=loc.get("link"),
                google_place_id=loc.get("googlePlaceId"),
                google_maps_uri=loc.get("googleMapsUri"),
                timezone_id=loc.get("timezoneId") or tzid_from_coords(loc.get("lat"), loc.get("lng")),
            )
        )


async def execute_action(db: AsyncSession, *, trip: TripRecord, action: AssistantAction) -> ActionResult:
    action_fields = _action_fields_dict(action)

    if action.target == "trip":
        if action.op != "update":
            return ActionResult(op=action.op, target=action.target, status="error", detail="Only update is supported for trip")

        fields = _normalize_trip_dates(action_fields, trip=trip)
        field_map = {
            "tripName": "trip_name",
            "status": "status",
            "startLocationName": "start_location_name",
            "destinationLocationName": "destination_location_name",
            "defaultTimezoneId": "default_timezone_id",
            "startDate": "start_date",
            "endDate": "end_date",
        }
        applied = 0
        for key, orm_field in field_map.items():
            if key in fields:
                setattr(trip, orm_field, fields[key])
                applied += 1
        if applied == 0:
            return ActionResult(op=action.op, target=action.target, status="error", detail="No supported trip fields provided")
        trip.updated_at = datetime.now(timezone.utc)
        await db.flush()
        return ActionResult(op=action.op, target=action.target, id=trip.trip_id, status="ok", detail=f"Updated {applied} trip field(s)")

    if action.target == "day":
        if action.op == "create":
            day_id = _coerce_uuid(action.id)
            if await db.get(TripDayRecord, day_id):
                return ActionResult(op=action.op, target=action.target, id=day_id, status="error", detail="Day already exists")
            title = action_fields.get("title")
            day_date = action_fields.get("date")
            if isinstance(day_date, str):
                normalized = normalize_date(
                    DateNormalizerInput(rawText=day_date, appCurrentDate=date.today().isoformat(), tripStartDate=trip.start_date, tripEndDate=trip.end_date)
                )
                day_date = normalized or day_date
            if not title or not day_date:
                return ActionResult(op=action.op, target=action.target, status="error", detail="Day create requires title and date")
            db.add(
                TripDayRecord(
                    day_id=day_id,
                    trip_id=trip.trip_id,
                    title=title,
                    date=day_date,
                    description=action_fields.get("description"),
                    is_alternate=bool(action_fields.get("isAlternate", False)),
                    completed=bool(action_fields.get("completed", False)),
                )
            )
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=day_id, status="ok")

        if not action.id:
            return ActionResult(op=action.op, target=action.target, status="error", detail="Day id is required")
        rec = await db.get(TripDayRecord, action.id)
        if rec is None or rec.trip_id != trip.trip_id or rec.is_deleted or rec.deleted_at is not None:
            return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail="Day not found")

        if action.op == "update":
            fields = dict(action_fields)
            if isinstance(fields.get("date"), str):
                normalized = normalize_date(
                    DateNormalizerInput(rawText=fields["date"], appCurrentDate=date.today().isoformat(), tripStartDate=trip.start_date, tripEndDate=trip.end_date)
                )
                if normalized:
                    fields["date"] = normalized
            field_map = {
                "title": "title",
                "date": "date",
                "description": "description",
                "isAlternate": "is_alternate",
                "completed": "completed",
            }
            for key, orm_field in field_map.items():
                if key in fields:
                    setattr(rec, orm_field, fields[key])
            rec.updated_at = datetime.now(timezone.utc)
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

        rec.is_deleted = True
        rec.deleted_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
        await db.flush()
        return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

    if action.target == "point":
        if action.op == "create":
            payload = dict(action_fields)
            payload["pointId"] = _coerce_uuid(action.id or payload.get("pointId"))
            payload.setdefault("locations", [])
            day_id = payload.get("dayId")
            if not day_id:
                return ActionResult(op=action.op, target=action.target, status="error", detail="Point create requires dayId")
            day = await db.get(TripDayRecord, day_id)
            if day is None or day.trip_id != trip.trip_id or day.is_deleted or day.deleted_at is not None:
                return ActionResult(op=action.op, target=action.target, id=payload["pointId"], status="error", detail="Day not found")
            try:
                body = TripPointCreate.model_validate(payload)
            except Exception as exc:
                return ActionResult(op=action.op, target=action.target, id=payload["pointId"], status="error", detail=str(exc))

            rec = TripPointRecord(
                point_id=body.pointId,
                trip_id=trip.trip_id,
                day_id=body.dayId,
                type=body.type,
                title=body.title,
                stay_detail_id=body.stayDetailId,
                travel_detail_id=body.travelDetailId,
                confirmation_number=body.confirmationNumber,
                description=body.description,
                image_url=body.imageUrl,
                logo_url=body.logoUrl,
                is_system_created=body.isSystemCreated,
                completed=body.completed,
                completed_date_time=body.completedDateTime,
            )
            rec.start_local = parse_wall_clock(body.startDateTime)
            rec.start_tzid = body.startTimezoneId or _trip_tz(trip)
            rec.start_utc = derive_utc(rec.start_local, rec.start_tzid)
            rec.end_local = parse_wall_clock(body.endDateTime)
            rec.end_tzid = body.endTimezoneId or rec.start_tzid
            rec.end_utc = derive_utc(rec.end_local, rec.end_tzid)
            rec.start_date_time = wall_clock_to_text(rec.start_local)
            rec.end_date_time = wall_clock_to_text(rec.end_local)
            db.add(rec)
            await db.flush()
            await _replace_point_locations(db, body.pointId, [loc.model_dump() for loc in body.locations])
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=body.pointId, status="ok")

        if not action.id:
            return ActionResult(op=action.op, target=action.target, status="error", detail="Point id is required")
        rec = await db.get(TripPointRecord, action.id)
        if rec is None or rec.trip_id != trip.trip_id or rec.is_deleted or rec.deleted_at is not None:
            return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail="Point not found")

        if action.op == "update":
            try:
                patch = TripPointPatch.model_validate(action_fields)
            except Exception as exc:
                return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail=str(exc))

            field_map = {
                "dayId": "day_id",
                "type": "type",
                "title": "title",
                "stayDetailId": "stay_detail_id",
                "travelDetailId": "travel_detail_id",
                "confirmationNumber": "confirmation_number",
                "description": "description",
                "imageUrl": "image_url",
                "logoUrl": "logo_url",
                "isSystemCreated": "is_system_created",
                "completed": "completed",
                "completedDateTime": "completed_date_time",
            }
            for key, orm_field in field_map.items():
                if key in patch.model_fields_set:
                    setattr(rec, orm_field, getattr(patch, key))

            if "startDateTime" in patch.model_fields_set:
                rec.start_local = parse_wall_clock(patch.startDateTime)
                rec.start_date_time = wall_clock_to_text(rec.start_local)
            if "endDateTime" in patch.model_fields_set:
                rec.end_local = parse_wall_clock(patch.endDateTime)
                rec.end_date_time = wall_clock_to_text(rec.end_local)

            if "startTimezoneId" in patch.model_fields_set:
                rec.start_tzid = patch.startTimezoneId or _trip_tz(trip)
            if "endTimezoneId" in patch.model_fields_set:
                rec.end_tzid = patch.endTimezoneId or rec.start_tzid or _trip_tz(trip)

            rec.start_utc = derive_utc(rec.start_local, rec.start_tzid)
            rec.end_utc = derive_utc(rec.end_local, rec.end_tzid)

            if "locations" in patch.model_fields_set:
                locs = [loc.model_dump() for loc in (patch.locations or [])]
                await _replace_point_locations(db, rec.point_id, locs)

            rec.updated_at = datetime.now(timezone.utc)
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

        rec.is_deleted = True
        rec.deleted_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
        await db.flush()
        return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

    if action.target == "stay":
        if action.op == "create":
            payload = dict(action_fields)
            payload["stayDetailId"] = _coerce_uuid(action.id or payload.get("stayDetailId"))
            payload.setdefault("locations", [])
            if not payload.get("stayType"):
                payload["stayType"] = "hotel"
            try:
                body = StayDetailImport.model_validate(payload)
            except Exception as exc:
                return ActionResult(op=action.op, target=action.target, id=payload["stayDetailId"], status="error", detail=str(exc))

            rec = StayDetailRecord(
                stay_detail_id=body.stayDetailId,
                trip_id=trip.trip_id,
                name=body.name,
                stay_type=body.stayType,
                room_type=body.roomType,
                confirmation_number=body.confirmationNumber,
                description=body.description,
            )
            rec.check_in_local = parse_wall_clock(body.checkIn)
            rec.check_in_tzid = body.checkInTimezoneId or _trip_tz(trip)
            rec.check_in_utc = derive_utc(rec.check_in_local, rec.check_in_tzid)
            rec.check_in = wall_clock_to_text(rec.check_in_local)
            rec.check_out_local = parse_wall_clock(body.checkOut)
            rec.check_out_tzid = body.checkOutTimezoneId or rec.check_in_tzid
            rec.check_out_utc = derive_utc(rec.check_out_local, rec.check_out_tzid)
            rec.check_out = wall_clock_to_text(rec.check_out_local)
            db.add(rec)
            await db.flush()
            await _replace_detail_locations(db, stay_id=rec.stay_detail_id, locations=[loc.model_dump() for loc in body.locations])
            await sync_stay_generated_points(db, stay=rec)
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=rec.stay_detail_id, status="ok")

        if not action.id:
            return ActionResult(op=action.op, target=action.target, status="error", detail="Stay id is required")
        rec = await db.get(StayDetailRecord, action.id)
        if rec is None or rec.trip_id != trip.trip_id or rec.is_deleted or rec.deleted_at is not None:
            return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail="Stay not found")

        if action.op == "update":
            try:
                patch = StayDetailPatch.model_validate(action_fields)
            except Exception as exc:
                return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail=str(exc))

            field_map = {
                "name": "name",
                "stayType": "stay_type",
                "roomType": "room_type",
                "confirmationNumber": "confirmation_number",
                "description": "description",
            }
            for key, orm_field in field_map.items():
                if key in patch.model_fields_set:
                    setattr(rec, orm_field, getattr(patch, key))

            if "checkIn" in patch.model_fields_set:
                rec.check_in_local = parse_wall_clock(patch.checkIn)
                rec.check_in = wall_clock_to_text(rec.check_in_local)
            if "checkOut" in patch.model_fields_set:
                rec.check_out_local = parse_wall_clock(patch.checkOut)
                rec.check_out = wall_clock_to_text(rec.check_out_local)
            if "checkInTimezoneId" in patch.model_fields_set:
                rec.check_in_tzid = patch.checkInTimezoneId or _trip_tz(trip)
            if "checkOutTimezoneId" in patch.model_fields_set:
                rec.check_out_tzid = patch.checkOutTimezoneId or rec.check_in_tzid

            rec.check_in_utc = derive_utc(rec.check_in_local, rec.check_in_tzid)
            rec.check_out_utc = derive_utc(rec.check_out_local, rec.check_out_tzid)

            if "locations" in patch.model_fields_set:
                locs = [loc.model_dump() for loc in (patch.locations or [])]
                await _replace_detail_locations(db, stay_id=rec.stay_detail_id, locations=locs)

            rec.updated_at = datetime.now(timezone.utc)
            await sync_stay_generated_points(db, stay=rec)
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

        rec.is_deleted = True
        rec.deleted_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
        await soft_delete_generated_points_for_stay(db, stay_detail_id=rec.stay_detail_id)
        await db.flush()
        return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

    if action.target == "travel":
        if action.op == "create":
            payload = dict(action_fields)
            payload["travelDetailId"] = _coerce_uuid(action.id or payload.get("travelDetailId"))
            payload.setdefault("locations", [])
            if not payload.get("mode"):
                payload["mode"] = "flight"
            try:
                body = TravelDetailImport.model_validate(payload)
            except Exception as exc:
                return ActionResult(op=action.op, target=action.target, id=payload["travelDetailId"], status="error", detail=str(exc))

            rec = TravelDetailRecord(
                travel_detail_id=body.travelDetailId,
                trip_id=trip.trip_id,
                name=body.name,
                mode=body.mode,
                operator=body.operator,
                vehicle_number=body.vehicleNumber,
                cabin_class=body.cabinClass,
                confirmation_number=body.confirmationNumber,
                description=body.description,
            )
            rec.departure_local = parse_wall_clock(body.departureDateTime)
            rec.departure_tzid = body.departureTimezoneId or _trip_tz(trip)
            rec.departure_utc = derive_utc(rec.departure_local, rec.departure_tzid)
            rec.departure_date_time = wall_clock_to_text(rec.departure_local)
            rec.arrival_local = parse_wall_clock(body.arrivalDateTime)
            rec.arrival_tzid = body.arrivalTimezoneId or rec.departure_tzid
            rec.arrival_utc = derive_utc(rec.arrival_local, rec.arrival_tzid)
            rec.arrival_date_time = wall_clock_to_text(rec.arrival_local)
            db.add(rec)
            await db.flush()
            await _replace_detail_locations(db, travel_id=rec.travel_detail_id, locations=[loc.model_dump() for loc in body.locations])
            await sync_travel_generated_points(db, travel=rec)
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=rec.travel_detail_id, status="ok")

        if not action.id:
            return ActionResult(op=action.op, target=action.target, status="error", detail="Travel id is required")
        rec = await db.get(TravelDetailRecord, action.id)
        if rec is None or rec.trip_id != trip.trip_id or rec.is_deleted or rec.deleted_at is not None:
            return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail="Travel not found")

        if action.op == "update":
            try:
                patch = TravelDetailPatch.model_validate(action_fields)
            except Exception as exc:
                return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail=str(exc))

            field_map = {
                "name": "name",
                "mode": "mode",
                "operator": "operator",
                "vehicleNumber": "vehicle_number",
                "cabinClass": "cabin_class",
                "confirmationNumber": "confirmation_number",
                "description": "description",
            }
            for key, orm_field in field_map.items():
                if key in patch.model_fields_set:
                    setattr(rec, orm_field, getattr(patch, key))

            if "departureDateTime" in patch.model_fields_set:
                rec.departure_local = parse_wall_clock(patch.departureDateTime)
                rec.departure_date_time = wall_clock_to_text(rec.departure_local)
            if "arrivalDateTime" in patch.model_fields_set:
                rec.arrival_local = parse_wall_clock(patch.arrivalDateTime)
                rec.arrival_date_time = wall_clock_to_text(rec.arrival_local)
            if "departureTimezoneId" in patch.model_fields_set:
                rec.departure_tzid = patch.departureTimezoneId or _trip_tz(trip)
            if "arrivalTimezoneId" in patch.model_fields_set:
                rec.arrival_tzid = patch.arrivalTimezoneId or rec.departure_tzid

            rec.departure_utc = derive_utc(rec.departure_local, rec.departure_tzid)
            rec.arrival_utc = derive_utc(rec.arrival_local, rec.arrival_tzid)

            if "locations" in patch.model_fields_set:
                locs = [loc.model_dump() for loc in (patch.locations or [])]
                await _replace_detail_locations(db, travel_id=rec.travel_detail_id, locations=locs)

            rec.updated_at = datetime.now(timezone.utc)
            await sync_travel_generated_points(db, travel=rec)
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

        rec.is_deleted = True
        rec.deleted_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
        await soft_delete_generated_points_for_travel(db, travel_detail_id=rec.travel_detail_id)
        await db.flush()
        return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

    return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail="Unsupported action target")


def should_suppress_follow_up(
    *,
    follow_up_question: str | None,
    trip: TripRecord,
    latest_message: str,
    recent_assistant_questions: list[str],
) -> bool:
    if not follow_up_question:
        return False

    q = follow_up_question.strip().lower()
    latest = (latest_message or "").lower()

    if q in {text.strip().lower() for text in recent_assistant_questions if text}:
        return True

    field_heuristics: list[tuple[str, str | None]] = [
        ("destination", trip.destination_location_name),
        ("where are you going", trip.destination_location_name),
        ("start date", trip.start_date),
        ("end date", trip.end_date),
        ("return", trip.end_date),
    ]
    for key, value in field_heuristics:
        if key in q and value:
            return True

    if "destination" in q and trip.destination_location_name and trip.destination_location_name.lower() in latest:
        return True

    return False


async def apply_assistant_turn(
    db: AsyncSession,
    *,
    trip: TripRecord,
    turn: AssistantTurn,
    latest_message: str,
    recent_assistant_questions: list[str],
) -> AppliedAssistantResult:
    results: list[ActionResult] = []
    persisted: list[AssistantAction] = []
    suppressed: list[dict[str, Any]] = []

    for action in turn.actions:
        try:
            result = await execute_action(db, trip=trip, action=action)
        except Exception as exc:
            result = ActionResult(
                op=action.op,
                target=action.target,
                id=action.id,
                status="error",
                detail=str(exc),
            )
        results.append(result)
        if result.status == "ok":
            persisted.append(action)
        else:
            suppressed.append({"action": action.model_dump(mode="json"), "reason": result.detail})

    follow_up_question = turn.followUpQuestion
    assistant_message = turn.assistantMessage
    if should_suppress_follow_up(
        follow_up_question=follow_up_question,
        trip=trip,
        latest_message=latest_message,
        recent_assistant_questions=recent_assistant_questions,
    ):
        follow_up_question = None
        if persisted:
            assistant_message = "Saved your updates. I can keep refining details whenever you are ready."

    outcome = AppliedAssistantResult(
        assistantMessage=assistant_message,
        followUpQuestion=follow_up_question,
        persistedActions=persisted,
        suppressedActions=suppressed,
        assumptions=turn.assumptions,
        unresolvedItems=turn.unresolvedItems,
        results=results,
    )
    log_ai_event(
        "ai.actions.applied",
        tripId=trip.trip_id,
        persistedActions=[item.model_dump(mode="json") for item in persisted],
        suppressedActions=suppressed,
        results=[item.model_dump(mode="json") for item in results],
        followUpQuestion=follow_up_question,
    )
    return outcome
