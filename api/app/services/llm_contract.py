from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ActionLocationFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    locationId: str | None = None
    role: str | None = None
    name: str | None = None
    lat: float | None = None
    lng: float | None = None
    fullAddress: str | None = None
    description: str | None = None
    link: str | None = None
    googlePlaceId: str | None = None
    googleMapsUri: str | None = None
    timezoneId: str | None = None


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

    userHomeLocation: UserHomeLocationContext = Field(default_factory=UserHomeLocationContext)
    userHomeTimezoneId: str | None = None
    uiContext: dict[str, Any] = Field(default_factory=dict)
