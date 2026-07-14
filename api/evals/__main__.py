"""Live eval runner CLI. Run from api/ (needs .env for OPENAI_API_KEY):

    python -m evals                     # run every scenario once, live
    python -m evals --scenario repeat   # substring filter
    python -m evals --runs 3 --threshold 0.67
    python -m evals --list
    python -m evals --json report.json
    python -m evals --verbose           # show tool calls + final messages
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from evals import db as eval_db
from evals.runner import ScenarioResult, run_scenario
from evals.scenario import load_scenarios


def _parse_args(argv):
    parser = argparse.ArgumentParser(prog="python -m evals", description=__doc__)
    parser.add_argument("--scenario", action="append", default=None, help="substring filter; repeatable")
    parser.add_argument("--runs", type=int, default=1, help="runs per scenario (default 1)")
    parser.add_argument("--threshold", type=float, default=1.0, help="pass rate required per scenario (default 1.0)")
    parser.add_argument("--list", action="store_true", help="list scenarios and exit")
    parser.add_argument("--json", dest="json_path", default=None, help="write a JSON report")
    parser.add_argument("--verbose", action="store_true", help="print tool calls and final messages")
    return parser.parse_args(argv)


def _require_openai_key():
    from app.settings import get_settings

    try:
        settings = get_settings()
    except Exception as exc:
        sys.exit(f"Could not load settings ({exc}). Run from api/ so .env is found.")
    if not settings.openai_api_key:
        sys.exit("OPENAI_API_KEY is not set — live evals need a real key. Run from api/ so .env is found.")


def _print_result(result: ScenarioResult, threshold: float, verbose: bool):
    status = "PASS" if result.passed(threshold) else "FAIL"
    rate = f"{sum(1 for r in result.runs if r.passed)}/{len(result.runs)}"
    print(f"[{status}] {result.scenario.name}  ({rate} runs)")
    if result.error:
        print(f"    run crashed: {result.error}")
    for i, run in enumerate(result.runs):
        failed = [c for c in run.check_results if not c.ok]
        if verbose or failed:
            tools = [tc["name"] for tc in (run.outcome.structuredContent or {}).get("toolLoop", {}).get("toolCalls", [])]
            print(f"    run {i + 1}: tools={tools}")
            if verbose:
                print(f"    run {i + 1}: message={run.outcome.assistantMessage[:200]!r}")
        for check in run.check_results:
            if not check.ok:
                print(f"    run {i + 1} ✗ {check.name} — {check.detail}")
            elif verbose:
                print(f"    run {i + 1} ✓ {check.name}")


def _report_dict(results: list[ScenarioResult], threshold: float, elapsed: float) -> dict:
    return {
        "ranAt": datetime.now(UTC).isoformat(),
        "threshold": threshold,
        "elapsedSeconds": round(elapsed, 1),
        "passed": sum(1 for r in results if r.passed(threshold)),
        "failed": sum(1 for r in results if not r.passed(threshold)),
        "scenarios": [
            {
                "name": r.scenario.name,
                "passed": r.passed(threshold),
                "passRate": r.pass_rate,
                "error": r.error,
                "runs": [
                    {
                        "passed": run.passed,
                        "assistantMessage": run.outcome.assistantMessage,
                        "toolCalls": (run.outcome.structuredContent or {}).get("toolLoop", {}).get("toolCalls", []),
                        "checks": [
                            {"name": c.name, "ok": c.ok, "detail": c.detail} for c in run.check_results
                        ],
                    }
                    for run in r.runs
                ],
            }
            for r in results
        ],
    }


async def _main(argv=None) -> int:
    args = _parse_args(argv)
    scenarios = load_scenarios()
    if args.scenario:
        scenarios = [s for s in scenarios if any(f.lower() in s.name.lower() for f in args.scenario)]
    if not scenarios:
        sys.exit("No scenarios matched.")

    if args.list:
        for s in scenarios:
            print(f"{s.name:36} {s.description}")
        return 0

    _require_openai_key()
    print(f"Running {len(scenarios)} scenario(s) × {args.runs} run(s) against the live model…\n")

    # Real database, real constraints — each scenario runs in its own
    # transaction and is rolled back (review.md 1C-3).
    await eval_db.setup()
    started = time.monotonic()
    results: list[ScenarioResult] = []
    try:
        for scenario in scenarios:
            result = await run_scenario(scenario, runs=args.runs)
            results.append(result)
            _print_result(result, args.threshold, args.verbose)
    finally:
        await eval_db.teardown()
    elapsed = time.monotonic() - started

    passed = sum(1 for r in results if r.passed(args.threshold))
    print(f"\n{passed}/{len(results)} scenarios passed (threshold {args.threshold}, {elapsed:.0f}s)")

    if args.json_path:
        report = json.dumps(_report_dict(results, args.threshold, elapsed), indent=2)
        await asyncio.to_thread(Path(args.json_path).write_text, report, encoding="utf-8")
        print(f"Report written to {args.json_path}")

    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
