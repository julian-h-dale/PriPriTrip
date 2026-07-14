"""Adapter: an `AssistantAction` from the model → a call into `trip_write`.

**There are no domain rules in this file.** Timezone inference, UTC derivation,
location resolution, generated-point syncing, day adoption, `promote_to_draft` —
all of that lives in `services/trip_write.py`, and the REST routers call the same
functions. This module only does the things that are specific to *the model being
the caller*:

* the model invents ids, so a create coerces them and an update rejects a
  non-UUID rather than handing "stay-1" to a UUID column;
* the model writes dates as prose ("Oct 30"), so trip dates go through the
  normalizer first;
* a refusal is not an exception here, it is a **tool result** — the model reads
  the message and corrects itself inside the same turn.

Before this split, the rules were implemented once here and again in the routers,
and the two copies drifted. See `review.md` R1–R4.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
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
    TripDayCreate,
    TripDayPatch,
    TripPatch,
    TripPointCreate,
    TripPointPatch,
)
from app.services import trip_write
from app.services.date_normalizer import DateNormalizerInput, normalize_date
from app.services.llm_contract import ActionResult, AssistantAction
from app.services.trip_write import WriteError

# ── Model-specific plumbing ──────────────────────────────────────────────────


def _coerce_uuid(value: str | None) -> str:
    """Server id for a create: the model's id if it is a real UUID, else a new one."""
    if value:
        try:
            return str(uuid.UUID(str(value)))
        except ValueError:
            pass
    return str(uuid.uuid4())


def _existing_id(value: str | None) -> str | None:
    """Canonical id for an update/delete, or None if it is not a server id.

    Rejecting here is deliberate: a non-UUID like "stay-1" would otherwise be
    handed straight to a UUID column and blow up the whole turn.
    """
    if not value:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (AttributeError, TypeError, ValueError):
        return None


def _created_id_detail(target: str, requested: str | None, assigned: str) -> str | None:
    """Tell the model when we ignored the id it invented.

    Silent regeneration meant the model believed it had named a record while the
    DB had a different id — and the same invented id used twice mapped to two
    different rows.
    """
    if requested and requested != assigned:
        return f"Ignored the supplied id {requested!r}; this {target} was created as {assigned}."
    return None


def _bad_id_detail(noun: str, value: str | None) -> str:
    if not value:
        return f"{noun} id is required."
    return (
        f"{value!r} is not a valid {noun.lower()} id. "
        f"Use an id from get_trip_snapshot, or create the record instead."
    )


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _as_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _action_fields(action: AssistantAction) -> dict[str, Any]:
    """What the model actually sent.

    `exclude_unset` — **not** `exclude_none`. The difference is the whole reason
    the assistant can clear a value: an explicit `null` ("remove that confirmation
    number, it's wrong") must survive all the way to `model_fields_set` in the
    write layer. `exclude_none` dropped it, the executor never saw it, nothing was
    written, and the tool cheerfully returned `ok`. See review.md R3.
    """
    return action.fields.model_dump(mode="json", exclude_unset=True)


def _normalize_trip_dates(fields: dict[str, Any], *, trip: TripRecord) -> dict[str, Any]:
    """The model writes dates as prose. Resolve them to real dates before the column."""
    result = dict(fields)
    today = date.today().isoformat()

    for key in ("startDate", "endDate"):
        if key not in result or result[key] is None:
            continue
        normalized = normalize_date(
            DateNormalizerInput(
                rawText=str(result[key]),
                appCurrentDate=today,
                tripStartDate=_iso(_as_date(result.get("startDate")) or trip.start_date),
                tripEndDate=_iso(_as_date(result.get("endDate")) or trip.end_date),
            )
        )
        result[key] = _as_date(normalized or result[key])
        # A date the model wrote that we could not parse must not reach the column.
        if result[key] is None:
            del result[key]

    return result


# ── The target table ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Target:
    noun: str  # "Stay" — for the model-facing messages
    model: type[Any]
    id_field: str  # the camelCase key the model uses
    create_schema: type[BaseModel]
    patch_schema: type[BaseModel]
    create: Callable[..., Awaitable[trip_write.WriteResult]]
    update: Callable[..., Awaitable[trip_write.WriteResult]]
    delete: Callable[..., Awaitable[None]]


TARGETS: dict[str, _Target] = {
    "stay": _Target(
        "Stay", StayDetailRecord, "stayDetailId",
        StayDetailImport, StayDetailPatch,
        trip_write.create_stay, trip_write.update_stay, trip_write.delete_stay,
    ),
    "travel": _Target(
        "Travel", TravelDetailRecord, "travelDetailId",
        TravelDetailImport, TravelDetailPatch,
        trip_write.create_travel, trip_write.update_travel, trip_write.delete_travel,
    ),
    "point": _Target(
        "Point", TripPointRecord, "pointId",
        TripPointCreate, TripPointPatch,
        trip_write.create_point, trip_write.update_point, trip_write.delete_point,
    ),
    "day": _Target(
        "Day", TripDayRecord, "dayId",
        TripDayCreate, TripDayPatch,
        trip_write.create_day, trip_write.update_day, trip_write.delete_day,
    ),
}


async def _load(db: AsyncSession, trip: TripRecord, spec: _Target, record_id: str):
    rec = await db.get(spec.model, record_id)
    if rec is None or rec.trip_id != trip.trip_id or rec.is_deleted or rec.deleted_at is not None:
        return None
    return rec


def _result(action: AssistantAction, **kw) -> ActionResult:
    return ActionResult(op=action.op, target=action.target, **kw)


# ── Entry point ──────────────────────────────────────────────────────────────


async def execute_action(
    db: AsyncSession, *, trip: TripRecord, action: AssistantAction
) -> ActionResult:
    """Apply one model action. A refusal comes back as a tool result, never a raise."""
    try:
        return await _dispatch(db, trip, action)
    except WriteError as exc:
        # The write layer's refusals are written *for the model* — they say what to
        # do instead, so it can recover inside the same turn.
        return _result(action, id=action.id, status="error", detail=str(exc))
    except ValidationError as exc:
        return _result(action, id=action.id, status="error", detail=str(exc))


async def _dispatch(db: AsyncSession, trip: TripRecord, action: AssistantAction) -> ActionResult:
    fields = _action_fields(action)

    # ── the trip header ──────────────────────────────────────────────────────
    if action.target == "trip":
        if action.op != "update":
            return _result(action, status="error", detail="Only update is supported for trip")

        patch = TripPatch.model_validate(_normalize_trip_dates(fields, trip=trip))
        if not patch.model_fields_set:
            return _result(action, status="error", detail="No supported trip fields provided")

        await trip_write.update_trip(db, trip, patch)
        return _result(
            action,
            id=trip.trip_id,
            status="ok",
            detail=f"Updated {len(patch.model_fields_set)} trip field(s)",
        )

    spec = TARGETS.get(action.target)
    if spec is None:
        return _result(action, status="error", detail=f"Unsupported target: {action.target}")

    # ── create ───────────────────────────────────────────────────────────────
    if action.op == "create":
        return await _create(db, trip, action, spec, fields)

    # ── update / delete need an existing record ──────────────────────────────
    record_id = _existing_id(action.id)
    if record_id is None:
        return _result(
            action, id=action.id, status="error", detail=_bad_id_detail(spec.noun, action.id)
        )

    rec = await _load(db, trip, spec, record_id)
    if rec is None:
        return _result(
            action, id=action.id, status="error", detail=f"{spec.noun} not found"
        )

    if action.op == "update":
        record_patch: Any = spec.patch_schema.model_validate(fields)
        result = await spec.update(db, trip, rec, record_patch)
        return _result(
            action, id=action.id, status="ok", locations=result.location_decisions
        )

    if action.op == "delete":
        await spec.delete(db, trip, rec)
        return _result(action, id=action.id, status="ok")

    return _result(action, id=action.id, status="error", detail=f"Unsupported op: {action.op}")


async def _create(
    db: AsyncSession,
    trip: TripRecord,
    action: AssistantAction,
    spec: _Target,
    fields: dict[str, Any],
) -> ActionResult:
    payload = dict(fields)
    assigned = _coerce_uuid(action.id or payload.get(spec.id_field))
    payload[spec.id_field] = assigned
    payload.setdefault("locations", [])

    # A point hangs off a day, so the day has to exist and be this trip's.
    day: TripDayRecord | None = None
    if action.target == "point":
        day_id = payload.get("dayId")
        if not day_id:
            return _result(action, status="error", detail="Point create requires dayId")
        day = await db.get(TripDayRecord, day_id)
        if (
            day is None
            or day.trip_id != trip.trip_id
            or day.is_deleted
            or day.deleted_at is not None
        ):
            return _result(action, id=assigned, status="error", detail="Day not found")

    if action.target == "stay" and not payload.get("stayType"):
        payload["stayType"] = "hotel"  # a stay the model didn't classify is a hotel

    if action.target == "day":
        payload["date"] = _as_date(payload.get("date"))
        if not payload.get("title") or not payload["date"]:
            return _result(
                action,
                status="error",
                detail="Day create requires a title and a date (ISO YYYY-MM-DD).",
            )

    data: Any = spec.create_schema.model_validate(payload)

    if action.target == "point":
        result = await spec.create(db, trip, day, data)
    elif action.target == "day":
        # "create_day" from the model means *name this date*. If the date already
        # has a day, rename it and hand back its id rather than adding a second.
        result = await spec.create(db, trip, data, adopt_existing=True)
    else:
        result = await spec.create(db, trip, data)

    created_id = getattr(result.record, spec.model.__mapper__.primary_key[0].name)

    # A "created" day that landed on a date which already had one was *renamed*,
    # not duplicated. Tell the model which id to use for the points it adds next.
    detail: str | None
    if action.target == "day" and getattr(result, "adopted", False):
        detail = (
            f"{data.date.isoformat()} already had a day, so it was renamed to "
            f"{data.title!r} rather than duplicated. Its id is {created_id} — use that "
            f"when adding points to this date."
        )
    else:
        detail = _created_id_detail(spec.noun.lower(), action.id, created_id)

    return _result(
        action,
        id=created_id,
        status="ok",
        locations=result.location_decisions,
        detail=detail,
    )
