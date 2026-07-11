"""LLM eval harness for the chat tool loop (review.md 3D-8).

Scenarios (evals/scenarios/*.json) encode the regression cases from
pripritrip_llm_integration_requirements.md Requirement 9 as structural
assertions — which tools were called, what was persisted, what the final
message must/must not say — rather than exact-string matches, because model
output is nondeterministic.

Two tiers:
- CI (every push): tests/test_eval_harness.py runs the harness machinery with
  a scripted client — proves the harness itself works, free and deterministic.
- Live (nightly / before+after prompt edits): `python -m evals` from api/
  replays every scenario against the real OpenAI API with the current prompt
  and tools. Costs cents per run.
"""
