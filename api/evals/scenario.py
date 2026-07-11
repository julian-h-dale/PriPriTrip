"""Scenario schema + loader for evals/scenarios/*.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"


class SeedDay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    date: str
    description: Optional[str] = None


class SeedStay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    stayType: str = "hotel"
    checkIn: Optional[str] = None
    checkOut: Optional[str] = None
    roomType: Optional[str] = None
    confirmationNumber: Optional[str] = None


class SeedTravel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    mode: str = "flight"
    departureDateTime: Optional[str] = None
    arrivalDateTime: Optional[str] = None
    confirmationNumber: Optional[str] = None


class SeedTrip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tripName: str = "New Trip Draft"
    status: str = "new"
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    startLocationName: Optional[str] = None
    destinationLocationName: Optional[str] = None
    defaultTimezoneId: Optional[str] = None


class PersistedSpec(BaseModel):
    """Must match at least one entry in structuredContent.persistedActions."""

    model_config = ConfigDict(extra="forbid")

    op: str
    target: str
    # Every key must be present in the action's fields; string values match
    # case-insensitively as substrings, everything else by equality.
    fieldsContain: dict = Field(default_factory=dict)


class Checks(BaseModel):
    model_config = ConfigDict(extra="forbid")

    toolsCalledInclude: list[str] = Field(default_factory=list)
    toolsCalledExclude: list[str] = Field(default_factory=list)
    persistedInclude: list[PersistedSpec] = Field(default_factory=list)
    tripFieldEquals: dict = Field(default_factory=dict)  # snake_case TripRecord attrs
    countsMin: dict[str, int] = Field(default_factory=dict)  # days/points/stays/travels
    countsMax: dict[str, int] = Field(default_factory=dict)
    finalMessageMatches: list[str] = Field(default_factory=list)  # case-insensitive regex
    finalMessageNotMatches: list[str] = Field(default_factory=list)
    maxIterations: Optional[int] = None
    capHit: Optional[bool] = None
    complete: Optional[bool] = None


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    requirement: Optional[str] = None  # pointer into the requirements doc / review.md
    workflowName: str = "trip:manage"
    trip: SeedTrip = Field(default_factory=SeedTrip)
    days: list[SeedDay] = Field(default_factory=list)
    stays: list[SeedStay] = Field(default_factory=list)
    travels: list[SeedTravel] = Field(default_factory=list)
    transcript: list[dict] = Field(default_factory=list)  # [{"role": ..., "message": ...}]
    message: str
    appCurrentDate: str = "2026-07-09"  # fixed date so relative-date checks are deterministic
    conversationSummary: Optional[str] = None
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
