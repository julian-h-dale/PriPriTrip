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
from app.services.date_normalizer import DateNormalizerInput, normalize_date
from app.services.detail_points import (
    reconcile_trip_days,
    soft_delete_generated_points_for_stay,
    soft_delete_generated_points_for_travel,
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services.llm_contract import ActionResult, AssistantAction
from app.services.location_resolver import enrich_location_dict
from app.services.locations import location_rows
from app.services.timezones import derive_utc, parse_wall_clock, wall_clock_to_text


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


async def _prepare_locations(locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for raw_loc in locations:
        loc = _ensure_location_id(dict(raw_loc))
        # The chat contract strips coords/place IDs from model output, so
        # every location is resolved server-side here (review.md 3C-6).
        loc = await enrich_location_dict(loc)
        prepared.append(loc)
    return prepared


def _action_fields_dict(action: AssistantAction) -> dict[str, Any]:
    return action.fields.model_dump(mode="json", exclude_none=True)


async def _replace_point_locations(db: AsyncSession, point_id: str, locations: list[dict[str, Any]]) -> None:
    await db.execute(delete(LocationRecord).where(LocationRecord.point_id == point_id))
    for row in location_rows(await _prepare_locations(locations), point_id=point_id):
        db.add(row)


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

    for row in location_rows(
        await _prepare_locations(locations), stay_detail_id=stay_id, travel_detail_id=travel_id
    ):
        db.add(row)


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
        dates_changed = False
        for key, orm_field in field_map.items():
            if key in fields:
                setattr(trip, orm_field, fields[key])
                applied += 1
                if key in ("startDate", "endDate"):
                    dates_changed = True
        if applied == 0:
            return ActionResult(op=action.op, target=action.target, status="error", detail="No supported trip fields provided")
        if dates_changed:
            # Keep day rows aligned with the new date range.
            await reconcile_trip_days(db, trip)
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
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

        rec.is_deleted = True
        rec.deleted_at = datetime.now(timezone.utc)
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
                point_id=body.point_id,
                trip_id=trip.trip_id,
                day_id=body.day_id,
                type=body.type,
                title=body.title,
                stay_detail_id=body.stay_detail_id,
                travel_detail_id=body.travel_detail_id,
                confirmation_number=body.confirmation_number,
                description=body.description,
                image_url=body.image_url,
                logo_url=body.logo_url,
                is_system_created=body.is_system_created,
                completed=body.completed,
                completed_date_time=body.completed_date_time,
            )
            rec.start_local = parse_wall_clock(body.start_date_time)
            rec.start_tzid = body.start_timezone_id or _trip_tz(trip)
            rec.start_utc = derive_utc(rec.start_local, rec.start_tzid)
            rec.end_local = parse_wall_clock(body.end_date_time)
            rec.end_tzid = body.end_timezone_id or rec.start_tzid
            rec.end_utc = derive_utc(rec.end_local, rec.end_tzid)
            rec.start_date_time = wall_clock_to_text(rec.start_local)
            rec.end_date_time = wall_clock_to_text(rec.end_local)
            db.add(rec)
            await db.flush()
            await _replace_point_locations(db, body.point_id, [loc.model_dump(by_alias=True) for loc in body.locations])
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=body.point_id, status="ok")

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

            # Field names match the ORM columns 1:1 now that schemas are snake_case.
            for field in (
                "day_id",
                "type",
                "title",
                "stay_detail_id",
                "travel_detail_id",
                "confirmation_number",
                "description",
                "image_url",
                "logo_url",
                "is_system_created",
                "completed",
                "completed_date_time",
            ):
                if field in patch.model_fields_set:
                    setattr(rec, field, getattr(patch, field))

            if "start_date_time" in patch.model_fields_set:
                rec.start_local = parse_wall_clock(patch.start_date_time)
                rec.start_date_time = wall_clock_to_text(rec.start_local)
            if "end_date_time" in patch.model_fields_set:
                rec.end_local = parse_wall_clock(patch.end_date_time)
                rec.end_date_time = wall_clock_to_text(rec.end_local)

            if "start_timezone_id" in patch.model_fields_set:
                rec.start_tzid = patch.start_timezone_id or _trip_tz(trip)
            if "end_timezone_id" in patch.model_fields_set:
                rec.end_tzid = patch.end_timezone_id or rec.start_tzid or _trip_tz(trip)

            rec.start_utc = derive_utc(rec.start_local, rec.start_tzid)
            rec.end_utc = derive_utc(rec.end_local, rec.end_tzid)

            if "locations" in patch.model_fields_set:
                locs = [loc.model_dump(by_alias=True) for loc in (patch.locations or [])]
                await _replace_point_locations(db, rec.point_id, locs)

            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

        rec.is_deleted = True
        rec.deleted_at = datetime.now(timezone.utc)
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
                stay_detail_id=body.stay_detail_id,
                trip_id=trip.trip_id,
                name=body.name,
                stay_type=body.stay_type,
                room_type=body.room_type,
                confirmation_number=body.confirmation_number,
                description=body.description,
            )
            rec.check_in_local = parse_wall_clock(body.check_in)
            rec.check_in_tzid = body.check_in_timezone_id or _trip_tz(trip)
            rec.check_in_utc = derive_utc(rec.check_in_local, rec.check_in_tzid)
            rec.check_in = wall_clock_to_text(rec.check_in_local)
            rec.check_out_local = parse_wall_clock(body.check_out)
            rec.check_out_tzid = body.check_out_timezone_id or rec.check_in_tzid
            rec.check_out_utc = derive_utc(rec.check_out_local, rec.check_out_tzid)
            rec.check_out = wall_clock_to_text(rec.check_out_local)
            db.add(rec)
            await db.flush()
            await _replace_detail_locations(db, stay_id=rec.stay_detail_id, locations=[loc.model_dump(by_alias=True) for loc in body.locations])
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

            # Field names match the ORM columns 1:1 now that schemas are snake_case.
            for field in ("name", "stay_type", "room_type", "confirmation_number", "description"):
                if field in patch.model_fields_set:
                    setattr(rec, field, getattr(patch, field))

            if "check_in" in patch.model_fields_set:
                rec.check_in_local = parse_wall_clock(patch.check_in)
                rec.check_in = wall_clock_to_text(rec.check_in_local)
            if "check_out" in patch.model_fields_set:
                rec.check_out_local = parse_wall_clock(patch.check_out)
                rec.check_out = wall_clock_to_text(rec.check_out_local)
            if "check_in_timezone_id" in patch.model_fields_set:
                rec.check_in_tzid = patch.check_in_timezone_id or _trip_tz(trip)
            if "check_out_timezone_id" in patch.model_fields_set:
                rec.check_out_tzid = patch.check_out_timezone_id or rec.check_in_tzid

            rec.check_in_utc = derive_utc(rec.check_in_local, rec.check_in_tzid)
            rec.check_out_utc = derive_utc(rec.check_out_local, rec.check_out_tzid)

            if "locations" in patch.model_fields_set:
                locs = [loc.model_dump(by_alias=True) for loc in (patch.locations or [])]
                await _replace_detail_locations(db, stay_id=rec.stay_detail_id, locations=locs)

            await sync_stay_generated_points(db, stay=rec)
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

        rec.is_deleted = True
        rec.deleted_at = datetime.now(timezone.utc)
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
                travel_detail_id=body.travel_detail_id,
                trip_id=trip.trip_id,
                name=body.name,
                mode=body.mode,
                operator=body.operator,
                vehicle_number=body.vehicle_number,
                cabin_class=body.cabin_class,
                confirmation_number=body.confirmation_number,
                description=body.description,
            )
            rec.departure_local = parse_wall_clock(body.departure_date_time)
            rec.departure_tzid = body.departure_timezone_id or _trip_tz(trip)
            rec.departure_utc = derive_utc(rec.departure_local, rec.departure_tzid)
            rec.departure_date_time = wall_clock_to_text(rec.departure_local)
            rec.arrival_local = parse_wall_clock(body.arrival_date_time)
            rec.arrival_tzid = body.arrival_timezone_id or rec.departure_tzid
            rec.arrival_utc = derive_utc(rec.arrival_local, rec.arrival_tzid)
            rec.arrival_date_time = wall_clock_to_text(rec.arrival_local)
            db.add(rec)
            await db.flush()
            await _replace_detail_locations(db, travel_id=rec.travel_detail_id, locations=[loc.model_dump(by_alias=True) for loc in body.locations])
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

            # Field names match the ORM columns 1:1 now that schemas are snake_case.
            for field in (
                "name",
                "mode",
                "operator",
                "vehicle_number",
                "cabin_class",
                "confirmation_number",
                "description",
            ):
                if field in patch.model_fields_set:
                    setattr(rec, field, getattr(patch, field))

            if "departure_date_time" in patch.model_fields_set:
                rec.departure_local = parse_wall_clock(patch.departure_date_time)
                rec.departure_date_time = wall_clock_to_text(rec.departure_local)
            if "arrival_date_time" in patch.model_fields_set:
                rec.arrival_local = parse_wall_clock(patch.arrival_date_time)
                rec.arrival_date_time = wall_clock_to_text(rec.arrival_local)
            if "departure_timezone_id" in patch.model_fields_set:
                rec.departure_tzid = patch.departure_timezone_id or _trip_tz(trip)
            if "arrival_timezone_id" in patch.model_fields_set:
                rec.arrival_tzid = patch.arrival_timezone_id or rec.departure_tzid

            rec.departure_utc = derive_utc(rec.departure_local, rec.departure_tzid)
            rec.arrival_utc = derive_utc(rec.arrival_local, rec.arrival_tzid)

            if "locations" in patch.model_fields_set:
                locs = [loc.model_dump(by_alias=True) for loc in (patch.locations or [])]
                await _replace_detail_locations(db, travel_id=rec.travel_detail_id, locations=locs)

            await sync_travel_generated_points(db, travel=rec)
            await db.flush()
            return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

        rec.is_deleted = True
        rec.deleted_at = datetime.now(timezone.utc)
        await soft_delete_generated_points_for_travel(db, travel_detail_id=rec.travel_detail_id)
        await db.flush()
        return ActionResult(op=action.op, target=action.target, id=action.id, status="ok")

    return ActionResult(op=action.op, target=action.target, id=action.id, status="error", detail="Unsupported action target")
