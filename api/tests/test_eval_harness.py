"""CI tier of the eval harness (review.md 3D-8).

Runs the harness machinery — scenario loading, the checks engine, and a full
run_scenario pass — with a scripted client. Free and deterministic; proves the
harness works so the live tier (`python -m evals`) only measures the model.
"""

import asyncio

from app.services.trip_state import WorkflowOutcome

from evals import mock_client
from evals.checks import evaluate
from evals.runner import build_session_and_trip, run_scenario
from evals.scenario import Checks, Scenario, load_scenarios


def _run(coro):
    return asyncio.run(coro)


def _scenario(**overrides) -> Scenario:
    data = {
        "name": "test-scenario",
        "description": "unit fixture",
        "workflowName": "trip:manage",
        "trip": {"tripName": "Kyoto Trip", "status": "draft", "destinationLocationName": "Kyoto"},
        "message": "We're staying at the Hyatt in Kyoto.",
        "checks": {},
    }
    data.update(overrides)
    return Scenario.model_validate(data)


def _outcome(*, message="Done.", tool_calls=(), persisted=(), iterations=1, cap_hit=False, complete=False):
    return WorkflowOutcome(
        assistantMessage=message,
        complete=complete,
        structuredContent={
            "actions": list(persisted),
            "persistedActions": list(persisted),
            "suppressedActions": [],
            "results": [],
            "followUpQuestion": None,
            "toolLoop": {
                "iterations": iterations,
                "capHit": cap_hit,
                "toolCalls": [{"iteration": 1, "name": n, "arguments": "{}", "result": {}} for n in tool_calls],
            },
        },
    )


class TestScenarioFiles:
    def test_all_shipped_scenarios_load_and_validate(self):
        scenarios = load_scenarios()
        assert len(scenarios) >= 10
        for scenario in scenarios:
            assert scenario.message
            assert scenario.checks != Checks(), f"{scenario.name} has no checks"


class TestChecksEngine:
    def setup_method(self):
        self.session, self.trip = build_session_and_trip(_scenario())

    def _evaluate(self, checks: dict, outcome: WorkflowOutcome):
        return evaluate(Checks.model_validate(checks), outcome=outcome, trip=self.trip, session=self.session)

    def test_tools_called_include_and_exclude(self):
        outcome = _outcome(tool_calls=["create_stay", "get_trip_snapshot"])
        results = self._evaluate(
            {"toolsCalledInclude": ["create_stay"], "toolsCalledExclude": ["delete_stay"]}, outcome
        )
        assert all(r.ok for r in results)

        results = self._evaluate(
            {"toolsCalledInclude": ["create_travel"], "toolsCalledExclude": ["create_stay"]}, outcome
        )
        assert not any(r.ok for r in results)

    def test_persisted_include_matches_substring_and_equality(self):
        action = {
            "op": "create",
            "target": "stay",
            "id": None,
            "fields": {"name": "Hyatt Regency Kyoto", "stayType": "hotel", "isAlternate": False},
        }
        outcome = _outcome(persisted=[action])

        ok = self._evaluate(
            {"persistedInclude": [{"op": "create", "target": "stay", "fieldsContain": {"name": "hyatt", "stayType": "hotel"}}]},
            outcome,
        )
        assert ok[0].ok

        wrong_field = self._evaluate(
            {"persistedInclude": [{"op": "create", "target": "stay", "fieldsContain": {"name": "Marriott"}}]},
            outcome,
        )
        assert not wrong_field[0].ok

        wrong_target = self._evaluate(
            {"persistedInclude": [{"op": "create", "target": "travel"}]},
            outcome,
        )
        assert not wrong_target[0].ok

    def test_trip_field_and_message_checks(self):
        self.trip.start_date = "2026-10-30"
        outcome = _outcome(message="Saved. Where are you flying from?")
        results = self._evaluate(
            {
                "tripFieldEquals": {"start_date": "2026-10-30"},
                "finalMessageMatches": ["\\?"],
                "finalMessageNotMatches": ["where are you going"],
            },
            outcome,
        )
        assert all(r.ok for r in results)

        results = self._evaluate({"finalMessageNotMatches": ["flying from"]}, outcome)
        assert not results[0].ok

    def test_iteration_cap_and_complete_checks(self):
        outcome = _outcome(iterations=6, cap_hit=True, complete=True)
        results = self._evaluate({"maxIterations": 3, "capHit": False, "complete": True}, outcome)
        by_name = {r.name: r.ok for r in results}
        assert by_name["iterations <= 3"] is False
        assert by_name["capHit == False"] is False
        assert by_name["complete == True"] is True


class TestRunScenario:
    def test_passing_run_with_scripted_client(self):
        scenario = _scenario(
            checks={
                "toolsCalledInclude": ["create_stay"],
                "persistedInclude": [{"op": "create", "target": "stay", "fieldsContain": {"stayType": "hotel"}}],
                "countsMin": {"stays": 1},
                "capHit": False,
            }
        )
        client = mock_client.ScriptedClient(
            [
                mock_client.response(
                    tool_calls=[mock_client.tool_call("create_stay", {"name": "Hyatt Kyoto", "stayType": "hotel"})]
                ),
                mock_client.response(content="Added the Hyatt Kyoto stay. Anything else?"),
            ]
        )
        result = _run(run_scenario(scenario, runs=1, client=client))
        assert result.error is None
        assert result.pass_rate == 1.0
        assert result.passed(1.0)

    def test_failing_checks_are_reported_not_raised(self):
        scenario = _scenario(
            checks={"persistedInclude": [{"op": "create", "target": "stay"}], "countsMin": {"stays": 1}}
        )
        client = mock_client.ScriptedClient(
            [mock_client.response(content="Sounds nice! Tell me more about your trip.")]
        )
        result = _run(run_scenario(scenario, runs=1, client=client))
        assert result.error is None
        assert result.pass_rate == 0.0
        assert not result.passed(1.0)
        failed = [c for c in result.runs[0].check_results if not c.ok]
        assert len(failed) == 2

    def test_crashed_run_is_captured_as_error(self):
        scenario = _scenario(checks={"capHit": False})
        client = mock_client.ScriptedClient([])  # runs out immediately
        result = _run(run_scenario(scenario, runs=1, client=client))
        assert result.error is not None
        assert not result.passed(1.0)
