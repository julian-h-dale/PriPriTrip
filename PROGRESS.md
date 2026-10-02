# PROGRESS

> Resumable state so a dropped session can pick up where it left off. The agent
> updates this after every phase (and whenever meaningful progress is made).
> Keep it short and current.

## Status

- **Current phase:** Phase 0 (reset onto template) done. Waiting on answers to
  the open questions in `implementation_plan.md` before Phase 1.
- **Branch:** `rebuild`
- **Last verified:** 2026-10-02. `make setup`, `make seed` and `make verify`
  green (7 API + 7 UI tests). API `/health` ok, seeded login works, UI serves
  on :3000.

## Done

- **Phase 0:**
  - Wiped the v1 code and dropped in `project-template` (`git archive` of
    template HEAD `72b3878`).
  - Preserved v1 material in `reference/`, with a gitignored
    `reference/private/` holding the old PDFs and notes plus the old `.env`
    backups.
  - Wrote `docs/lessons_learned.md`, `functional_spec.md` and
    `implementation_plan.md`.

## Next

1. Julian answers Open Questions 1–5 in `implementation_plan.md`.
2. Phase 1: trip document, generated JSON Schema, models.

## Notes / decisions

- v1 code lives on `main` (pre-rebuild) and `llm-translate`. Use it for
  knowledge, not code.
- Chat/AI and verification are out of scope until the core timeline is solid.
- Every import creates a new trip; invalid imports are rejected outright.
- `ui/.env` doesn't exist (template `make env` only creates `api/.env`); the UI
  uses the defaults (:3000 → API :8000).
