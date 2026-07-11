"""Per-target tool schemas + handlers for the chat tool-calling loop.

Each tool has its own small camelCase Pydantic argument model (review.md
3C-4: no shared 45-field optional bag), and each mutating tool converts its
arguments into the existing AssistantAction shape and runs through
trip_action_executor.execute_action — the executor stays the single write
path. Tool results (including executor validation errors) are returned to
the model as JSON, closing the feedback loop (review.md 3C-3 / 3A).

Location arguments deliberately use the restricted shape from
llm_contract.ActionLocationFields (name/role/description/link only): the
backend resolves place metadata server-side (review.md 3C-6).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import PointType, StayType, TravelMode
from app.models import TripRecord
from app.schemas import ChatForm
from app.services.chat_forms import FormError, build_form
from app.services.llm_contract import (
    ActionLocationFields,
    ActionResult,
    AssistantAction,
    AssistantActionFields,
)
from app.services.location_resolver import resolve_location_candidates
from app.services.trip_action_executor import execute_action


class _ToolArgs(BaseModel):
    """Base for tool argument models: camelCase-native, unknown keys rejected."""

    model_config = ConfigDict(extra="forbid")


# ── Trip ─────────────────────────────────────────────────────────────────────

class UpdateTripArgs(_ToolArgs):
    tripName: Optional[str] = None
    status: Optional[str] = None
    startLocationName: Optional[str] = None
    destinationLocationName: Optional[str] = None
    defaultTimezoneId: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None


# ── Day ──────────────────────────────────────────────────────────────────────

class CreateDayArgs(_ToolArgs):
    title: str
    date: str
    description: Optional[str] = None
    isAlternate: Optional[bool] = None


class UpdateDayArgs(_ToolArgs):
    dayId: str
    title: Optional[str] = None
    date: Optional[str] = None
    description: Optional[str] = None
    isAlternate: Optional[bool] = None


class DeleteDayArgs(_ToolArgs):
    dayId: str


# ── Point ────────────────────────────────────────────────────────────────────

class CreatePointArgs(_ToolArgs):
    dayId: str
    type: PointType
    title: str
    startDateTime: Optional[str] = None
    startTimezoneId: Optional[str] = None
    endDateTime: Optional[str] = None
    endTimezoneId: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: Optional[list[ActionLocationFields]] = None


class UpdatePointArgs(_ToolArgs):
    pointId: str
    dayId: Optional[str] = None
    type: Optional[PointType] = None
    title: Optional[str] = None
    startDateTime: Optional[str] = None
    startTimezoneId: Optional[str] = None
    endDateTime: Optional[str] = None
    endTimezoneId: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: Optional[list[ActionLocationFields]] = None


class DeletePointArgs(_ToolArgs):
    pointId: str


# ── Stay ─────────────────────────────────────────────────────────────────────

class CreateStayArgs(_ToolArgs):
    name: Optional[str] = None
    stayType: Optional[StayType] = None
    checkIn: Optional[str] = None
    checkInTimezoneId: Optional[str] = None
    checkOut: Optional[str] = None
    checkOutTimezoneId: Optional[str] = None
    roomType: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: Optional[list[ActionLocationFields]] = None


class UpdateStayArgs(_ToolArgs):
    stayDetailId: str
    name: Optional[str] = None
    stayType: Optional[StayType] = None
    checkIn: Optional[str] = None
    checkInTimezoneId: Optional[str] = None
    checkOut: Optional[str] = None
    checkOutTimezoneId: Optional[str] = None
    roomType: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: Optional[list[ActionLocationFields]] = None


class DeleteStayArgs(_ToolArgs):
    stayDetailId: str


# ── Travel ───────────────────────────────────────────────────────────────────

class CreateTravelArgs(_ToolArgs):
    name: Optional[str] = None
    mode: Optional[TravelMode] = None
    operator: Optional[str] = None
    vehicleNumber: Optional[str] = None
    cabinClass: Optional[str] = None
    departureDateTime: Optional[str] = None
    departureTimezoneId: Optional[str] = None
    arrivalDateTime: Optional[str] = None
    arrivalTimezoneId: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: Optional[list[ActionLocationFields]] = None


class UpdateTravelArgs(_ToolArgs):
    travelDetailId: str
    name: Optional[str] = None
    mode: Optional[TravelMode] = None
    operator: Optional[str] = None
    vehicleNumber: Optional[str] = None
    cabinClass: Optional[str] = None
    departureDateTime: Optional[str] = None
    departureTimezoneId: Optional[str] = None
    arrivalDateTime: Optional[str] = None
    arrivalTimezoneId: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    locations: Optional[list[ActionLocationFields]] = None


class DeleteTravelArgs(_ToolArgs):
    travelDetailId: str


# ── Read-only tools ──────────────────────────────────────────────────────────

class ResolveLocationArgs(_ToolArgs):
    query: str
    maxCandidates: int = Field(default=3, ge=1, le=5)


class GetTripSnapshotArgs(_ToolArgs):
    pass


# ── Forms (review.md 3F-2) ───────────────────────────────────────────────────

class RequestFormArgs(_ToolArgs):
    """The model names the record and the fields — nothing else.

    Types, labels, options and current values are filled in by the backend
    from the schemas it owns, so the model cannot invent a field type or an
    option that isn't real.
    """

    target: Literal["trip", "day", "point", "stay", "travel"]
    fields: list[str] = Field(min_length=1)
    recordId: Optional[str] = Field(
        default=None,
        description="Id of the record to edit. Omit to have the form create a new record.",
    )
    title: Optional[str] = None
    submitLabel: Optional[str] = None


# ── Handlers ─────────────────────────────────────────────────────────────────

@dataclass
class ToolOutcome:
    """What a tool execution produced.

    `result` is the JSON payload fed back to the model; `action`/
    `action_result` are set for mutating tools so the loop can build the
    structuredContent payload chat.py stores; `form` is set by request_form so
    the loop can attach it to the reply (review.md 3F-2).
    """

    result: dict
    action: AssistantAction | None = None
    action_result: ActionResult | None = None
    form: ChatForm | None = None


def _to_action(op: str, target: str, args: _ToolArgs, *, id_field: str | None = None) -> AssistantAction:
    data = args.model_dump(mode="json", exclude_none=True)
    action_id = data.pop(id_field, None) if id_field else None
    return AssistantAction(
        op=op,
        target=target,
        id=action_id,
        fields=AssistantActionFields.model_validate(data),
    )


def _action_handler(op: str, target: str, *, id_field: str | None = None):
    async def handler(db: AsyncSession, trip: TripRecord, args: _ToolArgs) -> ToolOutcome:
        action = _to_action(op, target, args, id_field=id_field)
        try:
            result = await execute_action(db, trip=trip, action=action)
        except Exception as exc:  # executor bugs must not kill the loop
            result = ActionResult(op=op, target=target, id=action.id, status="error", detail=str(exc))
        return ToolOutcome(
            result=result.model_dump(mode="json"),
            action=action,
            action_result=result,
        )

    return handler


async def _resolve_location_handler(db: AsyncSession, trip: TripRecord, args: ResolveLocationArgs) -> ToolOutcome:
    candidates = await resolve_location_candidates(args.query, max_candidates=args.maxCandidates)
    # Return only the human-meaningful fields; coords/place IDs stay
    # server-side (the model cannot write them anyway — review.md 3C-6).
    trimmed = [
        {
            "name": c.get("name"),
            "fullAddress": c.get("fullAddress"),
            "googleMapsUri": c.get("googleMapsUri"),
        }
        for c in candidates
    ]
    return ToolOutcome(result={"query": args.query, "candidates": trimmed})


async def _request_form_handler(db: AsyncSession, trip: TripRecord, args: RequestFormArgs) -> ToolOutcome:
    try:
        built = await build_form(
            db,
            trip=trip,
            target=args.target,
            record_id=args.recordId,
            field_names=args.fields,
            title=args.title,
            submit_label=args.submitLabel,
        )
    except FormError as exc:
        # A bad form request is the model's to fix — hand back the reason.
        return ToolOutcome(result={"status": "error", "detail": str(exc)})

    form = built.form
    # The model gets a compact acknowledgement, not the whole form: it does not
    # need the field types it did not choose, and the user sees the real thing.
    return ToolOutcome(
        result={
            "status": "ok",
            "detail": (
                f"A form is now shown to the user with these fields: "
                f"{', '.join(f.label for f in form.fields)}. "
                "Do not also ask for these details in your message — invite them to fill the form."
            ),
            "formId": form.form_id,
        },
        form=form,
    )


async def _get_trip_snapshot_handler(db: AsyncSession, trip: TripRecord, args: GetTripSnapshotArgs) -> ToolOutcome:
    from app.services.trip_state import assembled_trip

    snapshot = (await assembled_trip(db, trip)).model_dump(mode="json", by_alias=True)
    return ToolOutcome(result={"trip": snapshot})


# ── Registry ─────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[_ToolArgs]
    handler: Callable[[AsyncSession, TripRecord, _ToolArgs], Awaitable[ToolOutcome]]


TOOL_REGISTRY: dict[str, ToolSpec] = {
    spec.name: spec
    for spec in [
        ToolSpec(
            "update_trip",
            "Update top-level trip fields (name, status, start/destination location names, default timezone, start/end dates); include only the fields to change.",
            UpdateTripArgs,
            _action_handler("update", "trip"),
        ),
        ToolSpec(
            "create_day",
            "Create an itinerary day with a title and ISO date.",
            CreateDayArgs,
            _action_handler("create", "day"),
        ),
        ToolSpec(
            "update_day",
            "Update an existing itinerary day by dayId; include only the fields to change.",
            UpdateDayArgs,
            _action_handler("update", "day", id_field="dayId"),
        ),
        ToolSpec(
            "delete_day",
            "Delete an itinerary day by dayId.",
            DeleteDayArgs,
            _action_handler("delete", "day", id_field="dayId"),
        ),
        ToolSpec(
            "create_point",
            "Create an itinerary point (activity, departure, arrival, check-in, check-out) on an existing day.",
            CreatePointArgs,
            _action_handler("create", "point"),
        ),
        ToolSpec(
            "update_point",
            "Update an existing itinerary point by pointId; include only the fields to change.",
            UpdatePointArgs,
            _action_handler("update", "point", id_field="pointId"),
        ),
        ToolSpec(
            "delete_point",
            "Delete an itinerary point by pointId.",
            DeletePointArgs,
            _action_handler("delete", "point", id_field="pointId"),
        ),
        ToolSpec(
            "create_stay",
            "Create a stay (hotel/hostel/airbnb/rental); partial details are fine — save what the user provided.",
            CreateStayArgs,
            _action_handler("create", "stay"),
        ),
        ToolSpec(
            "update_stay",
            "Update an existing stay by stayDetailId; include only the fields to change.",
            UpdateStayArgs,
            _action_handler("update", "stay", id_field="stayDetailId"),
        ),
        ToolSpec(
            "delete_stay",
            "Delete a stay by stayDetailId.",
            DeleteStayArgs,
            _action_handler("delete", "stay", id_field="stayDetailId"),
        ),
        ToolSpec(
            "create_travel",
            "Create a travel leg (flight/train/car/bus/ferry/etc.); partial details are fine — save what the user provided.",
            CreateTravelArgs,
            _action_handler("create", "travel"),
        ),
        ToolSpec(
            "update_travel",
            "Update an existing travel leg by travelDetailId; include only the fields to change.",
            UpdateTravelArgs,
            _action_handler("update", "travel", id_field="travelDetailId"),
        ),
        ToolSpec(
            "delete_travel",
            "Delete a travel leg by travelDetailId.",
            DeleteTravelArgs,
            _action_handler("delete", "travel", id_field="travelDetailId"),
        ),
        ToolSpec(
            "resolve_location",
            "Look up a place name and return authoritative place candidates (name, address); use this to disambiguate locations before asking the user.",
            ResolveLocationArgs,
            _resolve_location_handler,
        ),
        ToolSpec(
            "get_trip_snapshot",
            "Return the full assembled trip JSON (trip fields, days, points, stays, travel legs, locations) for on-demand detail.",
            GetTripSnapshotArgs,
            _get_trip_snapshot_handler,
        ),
        ToolSpec(
            "request_form",
            (
                "Show the user a small form to fill in structured details instead of asking them to type it "
                "in prose. Use this for things people find tedious to say out loud — confirmation numbers, "
                "flight/train numbers, operators, cabin class, exact check-in/check-out or departure/arrival "
                "times. Name the target and the field names you want; the app supplies the labels, input "
                "types, options and current values. Omit recordId to have the form create a new record. "
                "Prefer one focused form over a long list of questions."
            ),
            RequestFormArgs,
            _request_form_handler,
        ),
    ]
}


def openai_tools() -> list[dict]:
    """OpenAI `tools=` list generated from the per-tool Pydantic models."""
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.args_model.model_json_schema(),
            },
        }
        for spec in TOOL_REGISTRY.values()
    ]
