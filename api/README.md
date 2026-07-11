# PriPriTrip API

FastAPI backend for PriPriTrip.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Python 3.12 |
| Framework | FastAPI |
| ORM | SQLAlchemy async |
| Validation | Pydantic v2 |
| Auth | fastapi-users + JWT bearer |
| Database | PostgreSQL 16 |
| AI | OpenAI structured outputs |

## Local setup

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Run locally

```bash
chmod +x dev.sh   # once
./dev.sh
```

API: http://localhost:8000

Docs:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### dev.sh modes

```bash
./dev.sh          # keep DB data, ensure schema, start API
./dev.sh --clean  # wipe DB volume, recreate schema, seed default superuser, start API
```

On --clean, the script seeds a default superuser:
- email: julian.h.dale@gmail.com
- password: honeymoon

## Environment variables

Configuration is loaded via pydantic-settings (`app/settings.py`, reads `.env`).

| Variable | Default | Description |
|---|---|---|
| DATABASE_URL | postgresql://postgres:postgres@localhost:5432/pripritrip | Database connection string |
| JWT_SECRET | **required — app refuses to boot without it** | JWT signing secret |
| CORS_ORIGINS | http://localhost:3000,http://localhost:5173 | Comma-separated CORS allowlist |
| MAPS_API_KEY | (empty) | Returned by auth session endpoints for UI |
| OPENAI_API_KEY | (unset) | Required for AI chat/import features |
| OPENAI_MODEL | gpt-5.4 | OpenAI model for AI flows |
| OPENAI_TIMEOUT | 120 | OpenAI timeout in seconds |
| OPENAI_MAX_RETRIES | 2 | OpenAI client retry count |
| APP_LOG_LEVEL | INFO | App logger level |
| AI_LOG_PATH | api/ai.log | AI trace log output path |
| AI_LOG_LEVEL | INFO | AI trace logger level |
| AI_LOG_MAX_BYTES | 10485760 | ai.log rotation max bytes |
| AI_LOG_BACKUP_COUNT | 3 | Number of rotated ai.log files |

## Auth model

The API uses fastapi-users JWT auth.

Primary endpoints:
- POST /auth/login
- POST /auth/logout
- POST /auth/register
- POST /auth/session
- POST /auth/register/session

The frontend uses /auth/session and /auth/register/session which return:
- token
- mapsApiKey

`/auth/login`, `/auth/logout`, and `/auth/register` are the stock fastapi-users routers (mounted in `main.py`). The two `*/session` endpoints are custom (`app/routers/auth.py`) and go through `Depends(get_user_manager)` like every other route, so `app.dependency_overrides` works in tests (review.md 1C-1). Failures are distinguished: bad credentials → 401, duplicate email or weak password → 400, an actual backend failure → 500 (it is never disguised as "invalid password").

## Major API areas

Ownership is enforced by a shared `get_owned_trip` dependency (`app/dependencies.py`); all trip-scoped routes 404 for missing/foreign/soft-deleted trips. Wire format is camelCase (snake_case Pydantic fields with `to_camel` aliases).

### Trips
- GET /trips
- GET /trips/{trip_id}
- GET /trips/{trip_id}/verify
- PUT /trips/{trip_id}  (upsert trip header; returns the header)
- DELETE /trips/{trip_id}

### Days
- GET /trips/{trip_id}/days
- GET /trips/{trip_id}/days/deleted
- POST /trips/{trip_id}/days
- PATCH /trips/{trip_id}/days/{day_id}
- DELETE /trips/{trip_id}/days/{day_id}
- POST /trips/{trip_id}/days/{day_id}/restore

### Points
- GET /trips/{trip_id}/points
- GET /trips/{trip_id}/points/deleted
- POST /trips/{trip_id}/points
- PATCH /trips/{trip_id}/points/{point_id}
- DELETE /trips/{trip_id}/points/{point_id}
- POST /trips/{trip_id}/points/{point_id}/restore

### Trip details (first-class travel/stay records)
- GET /trips/{trip_id}/travel-details
- POST /trips/{trip_id}/travel-details
- GET /trips/{trip_id}/travel-details/{travel_detail_id}
- PATCH /trips/{trip_id}/travel-details/{travel_detail_id}
- DELETE /trips/{trip_id}/travel-details/{travel_detail_id}
- GET /trips/{trip_id}/stay-details
- POST /trips/{trip_id}/stay-details
- GET /trips/{trip_id}/stay-details/{stay_detail_id}
- PATCH /trips/{trip_id}/stay-details/{stay_detail_id}
- DELETE /trips/{trip_id}/stay-details/{stay_detail_id}

### Bulk import
- POST /trips/{trip_id}/import  (full replace; trip id from path)

### AI import and document flows
- POST /trips/ai-import  (structure a document into a new draft; nothing persisted)
- POST /trips/{trip_id}/ai-import
- POST /trips/ai-enhance  (enhance an unsaved draft payload)
- POST /trips/{trip_id}/ai-documents
- GET /trips/{trip_id}/ai-documents
- GET /ai-documents/{document_id}
- POST /ai-documents/{document_id}/regen
- POST /ai-documents/{document_id}/save

Notes:
- Itinerary upload lock is status-based. A trip in status != new cannot re-run itinerary import.
- Detail document import remains available after itinerary lock.

### Chat workflows
- GET /chat/trips/{trip_id}?workflowName=...
- POST /chat/reply  (responds with Server-Sent Events, not JSON)

Chat architecture: all `trip:*` workflows run a tool-calling agent loop (`services/chat_tool_loop.py` + `services/chat_tools.py`). The model gets 15 typed tools (trip/day/point/stay/travel CRUD, `resolve_location`, `get_trip_snapshot`), executes them through `trip_action_executor`, sees each result (including validation errors) and self-corrects, capped at 6 iterations. A `verify_trip` "what's missing" checklist is injected as context each turn.

`POST /chat/reply` streams `text/event-stream` (review.md 3F-4):
- `status` — `{tool, label}` emitted before each tool call runs ("Adding a stay…")
- `delta` — `{text}` assistant-message tokens as OpenAI streams them
- `done` — the full reply payload (tripId, complete, tripName, verify, messages)
- `error` — `{detail}`; failures after the stream starts ride the stream instead of an HTTP error status. Pre-stream failures (401/404/422) are normal JSON errors.

Chat context behavior:
- Sends runtime context (incl. appCurrentDate in the user's home timezone), trip snapshot/summary, recent transcript window, rolling conversation summary, and optional UI context.

### Profile
- GET /profile
- PUT /profile
- DELETE /profile
- POST /profile/timezone

## Prompt architecture

Prompt configuration is centralized in:
- pripritrip_system_prompt.md

Prompt loading and composition:
- app/services/prompt_composer.py

Sections parsed from markdown:
- [base]
- [stage:assistant_tools]

This means prompt updates are content-driven from a single markdown file.

## AI trace logging

AI and chat workflow traces are written as JSON lines to:
- ai.log

Trace includes:
- model/state snapshots
- conversation metadata
- system and user prompts
- parsed structured outputs
- action execution results

Example:

```bash
cd api
tail -f ai.log
```

For a tabular view (filter/sort/export to CSV or Excel), use `ai_log_to_df.py`:

```bash
python ai_log_to_df.py                          # print a table of ai.log
python ai_log_to_df.py --grep chat.reply.outcome --tail 20
python ai_log_to_df.py --out ai_log.xlsx         # open in Excel/Numbers
python ai_log_to_df.py --interactive             # drop into a REPL with `df` loaded
```

Requires `pandas` (`pip install pandas`); standalone, no `app` package imports. Run `python ai_log_to_df.py --help` for all options.

## Project layout

```text
api/
├── app/
│   ├── main.py                  # App factory, CORS, auth session endpoints
│   ├── settings.py              # pydantic-settings config (reads .env)
│   ├── dependencies.py          # get_owned_trip ownership dependency
│   ├── models.py                # SQLAlchemy ORM models
│   ├── schemas.py               # Pydantic models (snake_case + camelCase aliases)
│   ├── enums.py                 # PointType, LocationRole, TravelMode, StayType, ...
│   ├── auth.py / users.py       # fastapi-users setup, JWT strategy
│   ├── database.py              # Async engine/session
│   ├── routers/
│   │   ├── auth.py              # /auth/session + /auth/register/session
│   │   ├── trip.py              # Trip CRUD + /verify
│   │   ├── trip_days.py         # Day CRUD + restore
│   │   ├── trip_points.py       # Point CRUD + restore
│   │   ├── trip_details.py      # Travel/stay detail CRUD
│   │   ├── trip_import.py       # Bulk trip import
│   │   ├── trip_ai_import.py    # AI itinerary/document import + enhance
│   │   ├── chat.py              # Chat workflows (/chat/reply)
│   │   └── profile.py           # User profile + timezone lookup
│   └── services/
│       ├── chat_tool_loop.py           # Tool-calling agent loop (the chat path)
│       ├── chat_tools.py               # Per-target tool schemas + dispatch
│       ├── trip_state.py               # Shared trip snapshot/summary helpers
│       ├── trip_action_executor.py     # Applies model-proposed actions to the DB
│       ├── openai_client.py            # Shared AsyncOpenAI client + traced parse
│       ├── llm_contract.py             # Structured-output models (AssistantTurn, actions)
│       ├── locations.py                # LocationRecord row construction helper
│       ├── prompt_composer.py          # Loads/validates prompt markdown sections
│       ├── trip_ai.py                  # Document extraction + enhancement (two-pass)
│       ├── document_ingest.py          # PDF/DOCX/XLSX → text
│       ├── date_normalizer.py          # Natural-language date → ISO fallback
│       ├── location_resolver.py        # Google Places enrichment
│       ├── timezones.py                # Wall-clock/tzid/UTC derivation
│       ├── detail_points.py            # Auto-generated points for stays/travels
│       ├── trip_verify.py              # Deterministic itinerary verification
│       └── ai_trace.py                 # JSONL AI trace logging
├── tests/
├── evals/                       # LLM eval harness: scenarios + live runner (python -m evals)
├── sql/                         # Hand-written additive DDL (no Alembic yet)
├── pripritrip_system_prompt.md  # System prompt ([base] + stage overlays)
├── ai.log                       # AI trace output (gitignored, rotated)
├── view_ai_log.sh               # Pretty-print / follow ai.log (jq)
├── ai_log_to_df.py              # Load ai.log into a pandas DataFrame (table view, CSV/Excel export)
├── dev.sh                       # DB + schema + API dev loop
├── docker-compose.yml           # PostgreSQL 16
├── init_db.py                   # create_all schema bootstrap (no migrations yet)
└── api.rest                     # REST client scratchpad
```

Note: there are no DB migrations yet by design — the schema is still moving fast. `dev.sh --clean` recreates the schema. Alembic is planned before any release (see `../review.md` 1B-4).

### Model conventions (review.md 1C-3)

`app/models.py` uses SQLAlchemy 2.0 declarative style: `Mapped[...]` + `mapped_column(...)`, where nullability comes from the annotation (`Mapped[str]` is NOT NULL, `Mapped[str | None]` is nullable).

- **Soft deletes**: use `active(Model)` / `deleted(Model)` in a WHERE clause instead of repeating the `is_deleted` + `deleted_at` pair.
- **`updated_at`**: carries `onupdate=func.now()`. Never set it by hand — the column maintains itself on every UPDATE.
- **Indexes**: every FK a query filters on is indexed (Postgres does not do this automatically), plus partial indexes on `NOT is_deleted` for the hot list paths.

`create_all` does **not** add indexes to tables that already exist. To pick up the indexes without wiping your data:

```bash
psql postgresql://postgres:postgres@localhost:5433/pripritrip -f sql/2026-07-11_add_indexes.sql
```

The script is idempotent (`CREATE INDEX IF NOT EXISTS`) and touches no data. `./dev.sh --clean` gets you the same schema from scratch.

## Tests

```bash
cd api
source .venv/bin/activate
pytest -q
```

Test dependencies live in `requirements-dev.txt` (`pip install -r requirements-dev.txt`). CI runs the suite plus frontend lint/build on every push (`.github/workflows/ci.yml`).

## LLM eval harness (review.md 3D-8)

`evals/` replays chat scenarios through the real tool loop and asserts on
behavior shape (tools called, actions persisted, resulting trip state, message
patterns) — never exact wording. Scenarios live in `evals/scenarios/*.json`
and encode the regression cases from
`pripritrip_llm_integration_requirements.md` Requirement 9 (date resolution,
no-repeat-question, partial capture, conflicts) plus loop-behavior guards
(read-only intent, no unprompted deletes).

Two tiers:
- **CI (free, every push):** `tests/test_eval_harness.py` runs the harness
  machinery with a scripted client — catches harness/loop/executor breakage.
- **Live (cents per run):** replays every scenario against the real model with
  the current prompt and tools. Run it before and after any prompt or
  tool-schema edit — this is what tells you whether the assistant got better
  or worse:

```bash
cd api && source .venv/bin/activate
python -m evals                          # full suite, live (needs OPENAI_API_KEY via .env)
python -m evals --list                   # enumerate scenarios
python -m evals --scenario repeat        # substring filter
python -m evals --runs 3 --threshold 0.67  # flake tolerance for stochastic cases
python -m evals --json eval_report.json  # machine-readable report (gitignored)
python -m evals --verbose                # show tool calls + final messages
```

Runs use an in-memory DB fake (`evals/fake_db.py`) so no PostgreSQL is needed;
location enrichment still hits Google Places when `MAPS_API_KEY` is set. A
full live run takes ~30s and every turn is traced to `ai.log` as usual.
Adding a scenario = adding a JSON file; the CI tier validates all scenario
files automatically.
