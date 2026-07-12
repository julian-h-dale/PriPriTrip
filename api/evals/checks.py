"""Structural assertions over a finished chat-loop turn.

Checks look at behavior shape — tools called, actions persisted, resulting
trip state, message patterns — never exact model wording.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    active,
)
from app.services.trip_state import WorkflowOutcome

from evals.scenario import Checks, PersistedSpec

_COUNT_MODELS = {
    "days": TripDayRecord,
    "points": TripPointRecord,
    "stays": StayDetailRecord,
    "travels": TravelDetailRecord,
}


async def _active_count(session: AsyncSession, key: str, trip: TripRecord) -> int:
    """Live rows of this kind on the trip — a real COUNT, not a dict length."""
    model = _COUNT_MODELS[key]
    result = await session.execute(
        select(func.count())
        .select_from(model)
        .where(model.trip_id == trip.trip_id, active(model))
    )
    return int(result.scalar_one())


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


def _tool_names(outcome: WorkflowOutcome) -> list[str]:
    tool_loop = (outcome.structuredContent or {}).get("toolLoop", {})
    return [tc["name"] for tc in tool_loop.get("toolCalls", [])]


def _fields_contain(action: dict, wanted: dict) -> bool:
    fields = action.get("fields") or {}
    for key, expected in wanted.items():
        actual = fields.get(key)
        if isinstance(expected, str):
            if not isinstance(actual, str) or expected.lower() not in actual.lower():
                return False
        elif actual != expected:
            return False
    return True


def _matches_persisted(outcome: WorkflowOutcome, spec: PersistedSpec) -> bool:
    persisted = (outcome.structuredContent or {}).get("persistedActions", [])
    return any(
        action.get("op") == spec.op
        and action.get("target") == spec.target
        and _fields_contain(action, spec.fieldsContain)
        for action in persisted
    )


async def evaluate(
    checks: Checks,
    *,
    outcome: WorkflowOutcome,
    trip: TripRecord,
    session: AsyncSession,
) -> list[CheckResult]:
    results: list[CheckResult] = []
    tool_names = _tool_names(outcome)
    tool_loop = (outcome.structuredContent or {}).get("toolLoop", {})
    message = outcome.assistantMessage or ""

    for name in checks.toolsCalledInclude:
        results.append(
            CheckResult(
                f"tool called: {name}",
                name in tool_names,
                f"called={tool_names}",
            )
        )

    for name in checks.toolsCalledExclude:
        results.append(
            CheckResult(
                f"tool NOT called: {name}",
                name not in tool_names,
                f"called={tool_names}",
            )
        )

    for spec in checks.persistedInclude:
        results.append(
            CheckResult(
                f"persisted: {spec.op} {spec.target} {spec.fieldsContain or ''}".strip(),
                _matches_persisted(outcome, spec),
                f"persisted={(outcome.structuredContent or {}).get('persistedActions', [])}",
            )
        )

    for attr, expected in checks.tripFieldEquals.items():
        actual = getattr(trip, attr, None)
        results.append(
            CheckResult(f"trip.{attr} == {expected!r}", actual == expected, f"actual={actual!r}")
        )

    for key, minimum in checks.countsMin.items():
        actual = await _active_count(session, key, trip)
        results.append(CheckResult(f"{key} >= {minimum}", actual >= minimum, f"actual={actual}"))

    for key, maximum in checks.countsMax.items():
        actual = await _active_count(session, key, trip)
        results.append(CheckResult(f"{key} <= {maximum}", actual <= maximum, f"actual={actual}"))

    for pattern in checks.finalMessageMatches:
        results.append(
            CheckResult(
                f"message matches /{pattern}/",
                bool(re.search(pattern, message, re.IGNORECASE)),
                f"message={message[:160]!r}",
            )
        )

    for pattern in checks.finalMessageNotMatches:
        results.append(
            CheckResult(
                f"message NOT matches /{pattern}/",
                not re.search(pattern, message, re.IGNORECASE),
                f"message={message[:160]!r}",
            )
        )

    if checks.maxIterations is not None:
        actual = tool_loop.get("iterations")
        results.append(
            CheckResult(
                f"iterations <= {checks.maxIterations}",
                actual is not None and actual <= checks.maxIterations,
                f"actual={actual}",
            )
        )

    if checks.capHit is not None:
        actual = tool_loop.get("capHit")
        results.append(CheckResult(f"capHit == {checks.capHit}", actual == checks.capHit, f"actual={actual}"))

    if checks.complete is not None:
        results.append(
            CheckResult(
                f"complete == {checks.complete}",
                outcome.complete == checks.complete,
                f"actual={outcome.complete}",
            )
        )

    return results
