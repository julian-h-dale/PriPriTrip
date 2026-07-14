"""Scenario schema + loader for evals/scenarios/*.json."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"


class SeedDay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    date: str
    description: str | None = None


class SeedStay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    stayType: str = "hotel"
    checkIn: str | None = None
    checkOut: str | None = None
    roomType: str | None = None
    confirmationNumber: str | None = None


class SeedTravel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    mode: str = "flight"
    departureDateTime: str | None = None
    arrivalDateTime: str | None = None
    confirmationNumber: str | None = None


class SeedTrip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tripName: str = "New Trip Draft"
    status: str = "new"
    startDate: str | None = None
    endDate: str | None = None
    startLocationName: str | None = None
    destinationLocationName: str | None = None
    defaultTimezoneId: str | None = None


class PersistedSpec(BaseModel):
    """Must match at least one entry in structuredContent.persistedActions."""

    model_config = ConfigDict(extra="forbid")

    op: str
    target: str
    # Every key must be present in the action's fields; string values match
    # case-insensitively as substrings, everything else by equality.
    fieldsContain: dict = Field(default_factory=dict)


class LocationSpec(BaseModel):
    """A location the turn must have left on the trip.

    Asserting the *stay* was created is not enough: the model can name a stay
    "Sheraton" and attach no location at all, which looks right in the reply
    and is unmappable in the app. This checks the location row itself.
    """

    model_config = ConfigDict(extra="forbid")

    nameMatches: str  # case-insensitive regex against the saved location name
    # True: must carry a Google place id (we were sure). False: must NOT (we
    # refused to guess, and the user is choosing).
    resolved: bool | None = None


class Checks(BaseModel):
    model_config = ConfigDict(extra="forbid")

    toolsCalledInclude: list[str] = Field(default_factory=list)
    toolsCalledExclude: list[str] = Field(default_factory=list)
    persistedInclude: list[PersistedSpec] = Field(default_factory=list)
    locationsInclude: list[LocationSpec] = Field(default_factory=list)
    tripFieldEquals: dict = Field(default_factory=dict)  # snake_case TripRecord attrs
    countsMin: dict[str, int] = Field(default_factory=dict)  # days/points/stays/travels
    countsMax: dict[str, int] = Field(default_factory=dict)
    finalMessageMatches: list[str] = Field(default_factory=list)  # case-insensitive regex
    finalMessageNotMatches: list[str] = Field(default_factory=list)
    # What the assistant handed the user to interact with: "choice", "form", or
    # "none" for a plain prose reply.
    uiPayloadKind: str | None = None
    maxIterations: int | None = None
    capHit: bool | None = None
    complete: bool | None = None


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    requirement: str | None = None  # pointer into the requirements doc / review.md
    workflowName: str = "trip:manage"
    trip: SeedTrip = Field(default_factory=SeedTrip)
    days: list[SeedDay] = Field(default_factory=list)
    stays: list[SeedStay] = Field(default_factory=list)
    travels: list[SeedTravel] = Field(default_factory=list)
    transcript: list[dict] = Field(default_factory=list)  # [{"role": ..., "message": ...}]
    message: str
    appCurrentDate: str = "2026-07-09"  # fixed date so relative-date checks are deterministic
    conversationSummary: str | None = None
    checks: Checks


def load_scenarios(directory: Path = SCENARIOS_DIR) -> list[Scenario]:
    scenarios = []
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        scenarios.append(Scenario.model_validate(data))
    names = [s.name for s in scenarios]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        raise ValueError(f"Duplicate scenario names: {sorted(dupes)}")
    return scenarios
