"""LLM wire contract for the chat workflows (camelCase-native by design).

These models ARE the contract — the prompt file no longer documents the
output shape or runtime context (the "Recommended Structured Output Shape"
and "Runtime Context Expected From App" sections were removed per review.md
3E-6; they were developer docs shipping as prompt tokens and promised context
keys the backend never sent):

- `AssistantTurn` is the structured-output shape for the legacy batch chat
  workflows, enforced via OpenAI structured outputs.
- `AssistantRuntimeContext` is the runtime context the app sends every turn
  (chat.py `_runtime_context_for_user`): `appCurrentDate` (today in the
  user's home timezone — the prompt's date policy depends on it),
  `userHomeLocation`, `userHomeTimezoneId`, and the free-form `uiContext`
  from the client.
- The tool-calling loop (chat_tool_loop.py) reuses `AssistantAction`/
  `ActionResult` internally; its per-tool argument schemas live in
  chat_tools.py.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ActionLocationFields(BaseModel):
    """Location fields the model may supply.

    Deliberately excludes lat/lng/fullAddress/googlePlaceId/googleMapsUri/
    timezoneId: models fabricate plausible-looking place metadata from memory,
    and pre-filled coords/place IDs used to bypass the authoritative Places
    resolver (review.md 3C-6). The backend resolves every location server-side
    from `name`.
    """

    model_config = ConfigDict(extra="forbid")

    locationId: str | None = None
    role: str | None = None
    name: str | None = None
    description: str | None = None
    link: str | None = None


class AssistantActionFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tripName: str | None = None
    status: str | None = None
    startLocationName: str | None = None
    destinationLocationName: str | None = None
    defaultTimezoneId: str | None = None
    startDate: str | None = None
    endDate: str | None = None

    dayId: str | None = None
    pointId: str | None = None
    stayDetailId: str | None = None
    travelDetailId: str | None = None
    title: str | None = None
    date: str | None = None
    type: str | None = None
    name: str | None = None
    mode: str | None = None
    stayType: str | None = None

    startDateTime: str | None = None
    startTimezoneId: str | None = None
    endDateTime: str | None = None
    endTimezoneId: str | None = None
    departureDateTime: str | None = None
    departureTimezoneId: str | None = None
    arrivalDateTime: str | None = None
    arrivalTimezoneId: str | None = None
    checkIn: str | None = None
    checkInTimezoneId: str | None = None
    checkOut: str | None = None
    checkOutTimezoneId: str | None = None

    operator: str | None = None
    vehicleNumber: str | None = None
    cabinClass: str | None = None
    roomType: str | None = None
    confirmationNumber: str | None = None
    description: str | None = None
    imageUrl: str | None = None
    logoUrl: str | None = None

    isAlternate: bool | None = None
    completed: bool | None = None
    isSystemCreated: bool | None = None
    completedDateTime: str | None = None

    locations: list[ActionLocationFields] | None = None


class AssistantAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["create", "update", "delete"]
    target: Literal["trip", "day", "point", "stay", "travel"]
    id: str | None = None
    fields: AssistantActionFields = Field(default_factory=AssistantActionFields)


class Assumption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["date", "location", "record_match", "timezone", "other"]
    description: str
    confidence: Literal["high", "medium", "low"]


class UnresolvedItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["date", "location", "record_match", "required_field", "other"]
    description: str
    blocking: bool


class AssistantTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assistantMessage: str
    actions: list[AssistantAction] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)
    unresolvedItems: list[UnresolvedItem] = Field(default_factory=list)
    followUpQuestion: str | None = None
    confidence: Literal["high", "medium", "low"] = "medium"


class ActionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: str
    target: str
    id: str | None = None
    status: Literal["ok", "error"]
    detail: str | None = None


class AppliedAssistantResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assistantMessage: str
    followUpQuestion: str | None
    persistedActions: list[AssistantAction] = Field(default_factory=list)
    suppressedActions: list[dict[str, Any]] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)
    unresolvedItems: list[UnresolvedItem] = Field(default_factory=list)
    results: list[ActionResult] = Field(default_factory=list)


class UserHomeLocationContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    fullAddress: str | None = None
    lat: float | None = None
    lng: float | None = None
    googlePlaceId: str | None = None
    googleMapsUri: str | None = None


class AssistantRuntimeContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Today's date (YYYY-MM-DD) in the user's home timezone. The prompt's
    # date policy resolves relative dates ("tomorrow", "this Friday")
    # against this — it must be sent on every turn.
    appCurrentDate: str | None = None
    userHomeLocation: UserHomeLocationContext = Field(default_factory=UserHomeLocationContext)
    userHomeTimezoneId: str | None = None
    uiContext: dict[str, Any] = Field(default_factory=dict)
