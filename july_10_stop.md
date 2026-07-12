# PriPriTrip — Stopping Point, July 10 2026

Where the big review-driven overhaul (see `review.md` at repo root) left off. All work is on branch `llm-translate`, **uncommitted** — the working tree is the source of truth. Item numbers below match `review.md`.

## Verified state at stop

| Check | Result |
|---|---|
| `cd api && python -m pytest -q` | **86 passed** |
| App boot (`from app.main import app`) | OK (requires `JWT_SECRET` in `api/.env` — already set, backup at `api/.env.bak`) |
| `cd ui && npm run lint` | clean |
| `cd ui && npx vitest run` | 20/20 passed |
| `cd ui && npm run build` | succeeds |
| CI | `.github/workflows/ci.yml` runs all of the above on push |

## Done (5 phases)

**Phase 1 — Safety nets**
- 2B-2 ESLint fixed (recommended rules + react plugin actually enabled)
- 2B-1 NewTripPage "Create Trip" crash fixed (days built client-side, correct import payload shape; helpers now in `ui/src/utils/newTripPayload.js`)
- 1B-2 stale test modules replaced; suite green; 4-1 CI added; `requirements-dev.txt`
- 2B-3 vitest scaffold + first real tests

**Phase 2 — Step-0 AI & security fixes**
- 1B-1/3C-1 AsyncOpenAI everywhere (shared `services/openai_client.py`); async `location_resolver` (httpx)
- 3C-2 `appCurrentDate` (user home tz) sent in runtime context every turn
- 3C-3 honest failure messages — model can't claim a save that failed
- 3C-6 model-writable location metadata stripped; all locations resolved server-side
- 1B-3 import authorizes before deleting; 1B-5 JWT_SECRET fail-hard + CORS allowlist; 1B-6 no raw exception text to clients
- 3E-7 day reconciliation now runs on chat-driven date changes (`detail_points.reconcile_trip_days`)

**Phase 3 — REST/API cleanup** (full route table in the Phase-3 section of `api/README.md`)
- 1C-5 paths unified under `/trips/*`; upsert → `PUT /trips/{id}`; duplicate PUT handlers removed; `api.rest` rewritten
- 1C-2 `get_owned_trip` dependency (`app/dependencies.py`) replaced 9 ownership-check copies; shared tz + location-row helpers; `_client/_parse` triplication gone
- 1C-4 pydantic-settings (`app/settings.py`)
- 1C-5 camelCase via Pydantic aliases; `serializers.py` deleted
- 1D-1 dead `trip_items.py` deleted; 1D-11/12 unused deps removed, `.dockerignore` added

**Phase 4 — Frontend data layer**
- 2B-5 RTK Query (`ui/src/store/apiSlice.js`); `tripSlice` deleted; tag invalidation replaces all manual refetches
- 2B-4 trip A/B race + spinner-blanking fixed; 2C-6 per-trip + list offline cache; 2C-4 error boundary; 2C-5 lazy routes; 2C-7 trips error branch; delete confirmation; 2B-7 `<Navigate>` fix

**Phase 5 — Tool-calling chat loop (the big one)**
- 3A/3C-4 chat now runs an agent loop by default: 15 typed tools (`services/chat_tools.py`), loop runner (`services/chat_tool_loop.py`), reusing `trip_action_executor`; executor errors feed back to the model in-turn; max 6 iterations with wrap-up
- 3D-2 `verify_trip` checklist replaces the stage machine on the loop path; 3C-5 canned completion no longer swallows model questions
- New prompt section `[stage:assistant_tools]`; 3E-6 dev-doc sections removed from the prompt file
- **Kill switch:** `CHAT_ASSISTANT_MODE=loop|batch` in `api/.env` (default loop; batch = legacy workflows, fully intact)

Also done outside the phases: repo cleanup (dead notes deleted, `enhace.md`→`enhance.md`), both READMEs + `.env.example` rewritten to current state, root `dev.sh` fixed (dead auth check → /health).

## Not done — remaining backlog (from review.md)

High value next:
-DONE **3D-8 Eval harness** — replay scripted chat scenarios against the loop (mock client in CI, live nightly); do this before heavy prompt iteration
-DONE **3F-4 Streaming** — SSE for the final message + "Adding your stay…" interim events; biggest UX win at current latencies
- **3F-2 Dynamic forms in chat** — `uiPayload` form/choice contract (sketch in review.md §3F); pairs with `resolve_location` candidates
- Delete the batch path + `should_suppress_follow_up` (3D-1) once the loop proves out in real use — compare `ai.chat_loop.*` vs legacy events in `ai.log`

Medium:
- DONE 1C-3 SQLAlchemy 2.0 style (`Mapped`/`relationship`), FK indexes, date columns instead of strings, soft-delete helper, `onupdate` for `updated_at`, N+1 fixes in points/details list endpoints
-DONE 1C-1 move `/auth/session` endpoints onto proper DI (unlocks real auth tests)
- DONE 3D-5 idempotency key on `/chat/reply`; 
-3D-6 compact per-turn trip snapshot (loop has `get_trip_snapshot` tool, context can slim down); 3D-3 real LLM summarization for long chats
- DONE 2C-1 Stay/Travel page dedupe; 2C-2 `usePlacesAutocomplete` hook; 2C-3 chat overlay UX (auto-scroll, Enter guard, timeout)
- 1C-7 ai.log PII redaction story (accepted for local-only)
- 3F-3 document-into-chat + email-forward ingestion; OCR/vision fallback for image PDFs

Deferred by decision (see `docs/MEMORY.md`): Alembic (pre-release), history scrubbing/data-file removal (never), TypeScript migration (revisit with RTK Query codegen).

## First things to do when resuming
1. `./dev.sh` and **exercise the chat loop end-to-end** with `./view_ai_log.sh -f` open — it has unit tests but hasn't been driven against the live OpenAI API yet.
2. Commit the working set (it's large; one checkpoint commit is fine).
3. Pick from "High value next" above.
