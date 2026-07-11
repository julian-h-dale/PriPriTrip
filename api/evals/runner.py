"""Run scenarios through the real chat tool loop and score the checks."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.models import StayDetailRecord, TravelDetailRecord, TripDayRecord, TripRecord
from app.services.chat_tool_loop import run_chat_tool_loop
from app.services.trip_state import WorkflowOutcome

from evals.checks import CheckResult, evaluate
from evals.fake_db import FakeSession
from evals.scenario import Scenario

EVAL_USER_ID = "eval-user"


def build_session_and_trip(scenario: Scenario) -> tuple[FakeSession, TripRecord]:
    session = FakeSession()
    # A chat trip always has dates in production — chat.py's shell trip gets
    # today's date — so default missing dates to the scenario's app date.
    trip = TripRecord(
        trip_id=str(uuid.uuid4()),
        user_id=EVAL_USER_ID,
        trip_name=scenario.trip.tripName,
        status=scenario.trip.status,
        start_date=scenario.trip.startDate or scenario.appCurrentDate,
        end_date=scenario.trip.endDate or scenario.appCurrentDate,
        start_location_name=scenario.trip.startLocationName,
        destination_location_name=scenario.trip.destinationLocationName,
        default_timezone_id=scenario.trip.defaultTimezoneId,
    )
    session.add(trip)
    for day in scenario.days:
        session.add(
            TripDayRecord(
                day_id=str(uuid.uuid4()),
                trip_id=trip.trip_id,
                title=day.title,
                date=day.date,
                description=day.description,
                # Column defaults only apply on a real DB flush; the response
                # models require real booleans.
                is_alternate=False,
                completed=False,
            )
        )
    for stay in scenario.stays:
        session.add(
            StayDetailRecord(
                stay_detail_id=str(uuid.uuid4()),
                trip_id=trip.trip_id,
                name=stay.name,
                stay_type=stay.stayType,
                check_in=stay.checkIn,
                check_out=stay.checkOut,
                room_type=stay.roomType,
                confirmation_number=stay.confirmationNumber,
            )
        )
    for travel in scenario.travels:
        session.add(
            TravelDetailRecord(
                travel_detail_id=str(uuid.uuid4()),
                trip_id=trip.trip_id,
                name=travel.name,
                mode=travel.mode,
                departure_date_time=travel.departureDateTime,
                arrival_date_time=travel.arrivalDateTime,
                confirmation_number=travel.confirmationNumber,
            )
        )
    return session, trip


def _runtime_context(scenario: Scenario) -> dict:
    # Mirrors chat.py's _runtime_context_for_user shape so the prompt's
    # date policy sees the same contract it gets in production.
    return {
        "appCurrentDate": scenario.appCurrentDate,
        "userHomeLocation": {},
        "userHomeTimezoneId": None,
        "uiContext": {"source": "eval-harness", "scenario": scenario.name},
    }


@dataclass
class RunResult:
    outcome: WorkflowOutcome
    check_results: list[CheckResult]

    @property
    def passed(self) -> bool:
        return all(c.ok for c in self.check_results)


@dataclass
class ScenarioResult:
    scenario: Scenario
    runs: list[RunResult] = field(default_factory=list)
    error: str | None = None

    @property
    def pass_rate(self) -> float:
        if not self.runs:
            return 0.0
        return sum(1 for r in self.runs if r.passed) / len(self.runs)

    def passed(self, threshold: float) -> bool:
        return self.error is None and self.pass_rate >= threshold


async def run_once(scenario: Scenario, *, client=None) -> RunResult:
    session, trip = build_session_and_trip(scenario)
    outcome = await run_chat_tool_loop(
        session,
        trip=trip,
        transcript=scenario.transcript,
        latest_message=scenario.message,
        conversation_summary=scenario.conversationSummary,
        ui_context=_runtime_context(scenario),
        workflow_name=scenario.workflowName,
        client=client,
    )
    check_results = evaluate(scenario.checks, outcome=outcome, trip=trip, session=session)
    return RunResult(outcome=outcome, check_results=check_results)


async def run_scenario(scenario: Scenario, *, runs: int = 1, client=None) -> ScenarioResult:
    result = ScenarioResult(scenario=scenario)
    for _ in range(runs):
        try:
            result.runs.append(await run_once(scenario, client=client))
        except Exception as exc:  # a crashed run is a failed run, keep going
            result.error = f"{type(exc).__name__}: {exc}"
            break
    return result
