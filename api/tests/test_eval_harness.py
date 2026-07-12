"""CI tier of the eval harness (review.md 3D-8).

Runs the harness machinery — scenario loading, the checks engine, and a full
run_scenario pass — with a scripted client, so it is free and deterministic.
The live tier (`python -m evals`) then only measures the model.

Since 1C-3 the harness runs against a real database, so these exercise the same
SQL the live evals do.
"""

import pytest_asyncio

from app.services.trip_state import WorkflowOutcome

from evals import db as eval_db
from evals import mock_client
from evals.checks import evaluate
from evals.scenario import Checks, Scenario, load_scenarios
from evals.runner import run_scenario

from tests.factories import make_stay, make_trip


@pytest_asyncio.fixture(scope="session")
async def eval_database():
    """The evals keep their own database; stand it up once for these tests."""
    await eval_db.setup()
    yield
    await eval_db.teardown()


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
            "uiPayload": None,
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
    async def _evaluate(self, db, trip, checks: dict, outcome: WorkflowOutcome):
        return await evaluate(
            Checks.model_validate(checks), outcome=outcome, trip=trip, session=db
        )

    async def test_tools_called_include_and_exclude(self, db, user):
        trip = await make_trip(db, user)
        outcome = _outcome(tool_calls=["create_stay", "get_trip_snapshot"])

        results = await self._evaluate(
            db, trip, {"toolsCalledInclude": ["create_stay"], "toolsCalledExclude": ["delete_stay"]}, outcome
        )
        assert all(r.ok for r in results)

        results = await self._evaluate(
            db, trip, {"toolsCalledInclude": ["create_travel"], "toolsCalledExclude": ["create_stay"]}, outcome
        )
        assert not any(r.ok for r in results)

    async def test_persisted_include_matches_substring_and_equality(self, db, user):
        trip = await make_trip(db, user)
        action = {
            "op": "create",
            "target": "stay",
            "id": None,
            "fields": {"name": "Hyatt Regency Kyoto", "stayType": "hotel", "isAlternate": False},
        }
        outcome = _outcome(persisted=[action])

        ok = await self._evaluate(
            db, trip,
            {"persistedInclude": [{"op": "create", "target": "stay", "fieldsContain": {"name": "hyatt", "stayType": "hotel"}}]},
            outcome,
        )
        assert ok[0].ok

        wrong_field = await self._evaluate(
            db, trip,
            {"persistedInclude": [{"op": "create", "target": "stay", "fieldsContain": {"name": "Marriott"}}]},
            outcome,
        )
        assert not wrong_field[0].ok

        wrong_target = await self._evaluate(
            db, trip, {"persistedInclude": [{"op": "create", "target": "travel"}]}, outcome
        )
        assert not wrong_target[0].ok

    async def test_counts_come_from_real_sql(self, db, user):
        """The count checks used to read a dict; now they COUNT(*) the table."""
        trip = await make_trip(db, user)
        await make_stay(db, trip)
        await make_stay(db, trip, is_deleted=True)  # must not be counted
        outcome = _outcome()

        results = await self._evaluate(
            db, trip, {"countsMin": {"stays": 1}, "countsMax": {"stays": 1}}, outcome
        )

        assert all(r.ok for r in results), [r.detail for r in results if not r.ok]

    async def test_counts_are_scoped_to_the_trip(self, db, user):
        trip = await make_trip(db, user)
        other = await make_trip(db, user, trip_name="Other")
        await make_stay(db, other)  # belongs to a different trip
        outcome = _outcome()

        results = await self._evaluate(db, trip, {"countsMax": {"stays": 0}}, outcome)

        assert results[0].ok

    async def test_trip_field_and_message_checks(self, db, user):
        trip = await make_trip(db, user, start_date="2026-10-30")
        outcome = _outcome(message="Saved. Where are you flying from?")

        results = await self._evaluate(
            db, trip,
            {
                "tripFieldEquals": {"start_date": "2026-10-30"},
                "finalMessageMatches": ["\\?"],
                "finalMessageNotMatches": ["where are you going"],
            },
            outcome,
        )
        assert all(r.ok for r in results)

        results = await self._evaluate(db, trip, {"finalMessageNotMatches": ["flying from"]}, outcome)
        assert not results[0].ok

    async def test_iteration_cap_and_complete_checks(self, db, user):
        trip = await make_trip(db, user)
        outcome = _outcome(iterations=6, cap_hit=True, complete=True)

        results = await self._evaluate(
            db, trip, {"maxIterations": 3, "capHit": False, "complete": True}, outcome
        )

        by_name = {r.name: r.ok for r in results}
        assert by_name["iterations <= 3"] is False
        assert by_name["capHit == False"] is False
        assert by_name["complete == True"] is True


class TestRunScenario:
    async def test_passing_run_with_scripted_client(self, eval_database):
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

        result = await run_scenario(scenario, runs=1, client=client)

        assert result.error is None
        assert result.pass_rate == 1.0

    async def test_failing_checks_are_reported_not_raised(self, eval_database):
        scenario = _scenario(
            checks={"persistedInclude": [{"op": "create", "target": "stay"}], "countsMin": {"stays": 1}}
        )
        client = mock_client.ScriptedClient(
            [mock_client.response(content="Sounds nice! Tell me more about your trip.")]
        )

        result = await run_scenario(scenario, runs=1, client=client)

        assert result.error is None
        assert result.pass_rate == 0.0
        failed = [c for c in result.runs[0].check_results if not c.ok]
        assert len(failed) == 2

    async def test_crashed_run_is_captured_as_error(self, eval_database):
        scenario = _scenario(checks={"capHit": False})
        client = mock_client.ScriptedClient([])  # runs out immediately

        result = await run_scenario(scenario, runs=1, client=client)

        assert result.error is not None
        assert not result.passed(1.0)

    async def test_each_scenario_run_is_rolled_back(self, eval_database):
        """Scenario writes are real, but they must not accumulate."""
        scenario = _scenario(
            checks={"countsMax": {"stays": 1}},
            stays=[],
        )

        def _client():
            return mock_client.ScriptedClient(
                [
                    mock_client.response(
                        tool_calls=[mock_client.tool_call("create_stay", {"name": "Hyatt", "stayType": "hotel"})]
                    ),
                    mock_client.response(content="Added."),
                ]
            )

        first = await run_scenario(scenario, runs=1, client=_client())
        second = await run_scenario(scenario, runs=1, client=_client())

        # If the first run's stay had survived, the second would count 2.
        assert first.pass_rate == 1.0
        assert second.pass_rate == 1.0
