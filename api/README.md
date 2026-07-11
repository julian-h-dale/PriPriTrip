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
| CHAT_ASSISTANT_MODE | loop | `loop` = tool-calling chat loop; `batch` = legacy one-shot workflows (kill switch) |
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
- POST /chat/reply

Chat architecture (CHAT_ASSISTANT_MODE):
- `loop` (default): a tool-calling agent loop (`services/chat_tool_loop.py` + `services/chat_tools.py`). The model gets 15 typed tools (trip/day/point/stay/travel CRUD, `resolve_location`, `get_trip_snapshot`), executes them through `trip_action_executor`, sees each result (including validation errors) and self-corrects, capped at 6 iterations. A `verify_trip` "what's missing" checklist is injected as context each turn.
- `batch` (kill switch): the legacy one-shot structured-output workflows — trip:new_trip staged welcome → travel → stay, and the trip:* CRUD assistant.

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
- [stage:welcome]
- [stage:travel]
- [stage:stay]
- [stage:assistant_actions]

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
│   │   ├── trip.py              # Trip CRUD + /verify
│   │   ├── trip_days.py         # Day CRUD + restore
│   │   ├── trip_points.py       # Point CRUD + restore
│   │   ├── trip_details.py      # Travel/stay detail CRUD
│   │   ├── trip_import.py       # Bulk trip import
│   │   ├── trip_ai_import.py    # AI itinerary/document import + enhance
│   │   ├── chat.py              # Chat workflows (/chat/reply)
│   │   └── profile.py           # User profile + timezone lookup
│   └── services/
│       ├── chat_tool_loop.py           # Tool-calling agent loop (default chat path)
│       ├── chat_tools.py               # Per-target tool schemas + dispatch
│       ├── new_trip_workflow.py        # Legacy staged workflow (batch mode)
│       ├── trip_assistant_workflow.py  # Legacy CRUD assistant (batch mode)
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
├── pripritrip_system_prompt.md  # System prompt ([base] + stage overlays)
├── ai.log                       # AI trace output (gitignored, rotated)
├── view_ai_log.sh               # Pretty-print / follow ai.log (jq)
├── dev.sh                       # DB + schema + API dev loop
├── docker-compose.yml           # PostgreSQL 16
├── init_db.py                   # create_all schema bootstrap (no migrations yet)
└── api.rest                     # REST client scratchpad
```

Note: there are no DB migrations yet by design — the schema is still moving fast. `dev.sh --clean` recreates the schema. Alembic is planned before any release (see `../review.md` 1B-4).

## Tests

```bash
cd api
source .venv/bin/activate
pytest -q
```

Test dependencies live in `requirements-dev.txt` (`pip install -r requirements-dev.txt`). CI runs the suite plus frontend lint/build on every push (`.github/workflows/ci.yml`).
