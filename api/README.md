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

| Variable | Default | Description |
|---|---|---|
| DATABASE_URL | postgresql://postgres:postgres@localhost:5432/pripritrip | Database connection string |
| JWT_SECRET | dev-secret-change-me | JWT signing secret |
| MAPS_API_KEY | (empty) | Returned by auth session endpoints for UI |
| OPENAI_API_KEY | (unset) | Required for AI chat/import features |
| OPENAI_MODEL | gpt-5.4 | OpenAI model for structured AI flows |
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

## Major API areas

### Trips
- GET /trips
- GET /trips/{trip_id}
- GET /trips/{trip_id}/verify
- POST /trips
- DELETE /trips/{trip_id}

### Days
- GET /trips/{trip_id}/days
- GET /trips/{trip_id}/days/deleted
- POST /trips/{trip_id}/days
- PUT /trips/{trip_id}/days/{day_id}
- PATCH /trips/{trip_id}/days/{day_id}
- DELETE /trips/{trip_id}/days/{day_id}
- POST /trips/{trip_id}/days/{day_id}/restore

### Points
- GET /trips/{trip_id}/points
- GET /trips/{trip_id}/points/deleted
- POST /trips/{trip_id}/points
- PUT /trips/{trip_id}/points/{point_id}
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
- POST /trip/import

### AI import and document flows
- POST /trip/ai-import
- POST /trip/ai-enhance
- POST /trip/ai-document
- GET /trips/{trip_id}/ai-documents
- GET /trip/ai-document/{document_id}
- POST /trip/ai-document/{document_id}/regen
- POST /trip/ai-document/{document_id}/save

Notes:
- Itinerary upload lock is status-based. A trip in status != new cannot re-run itinerary import.
- Detail document import remains available after itinerary lock.

### Chat workflows
- GET /chat/trips/{trip_id}?workflowName=...
- POST /chat/reply

Workflows:
- trip:new_trip: staged welcome -> travel -> stay collection
- trip:* (other): action-oriented CRUD assistant flow

Chat context behavior:
- Sends full trip snapshot, recent transcript window, rolling conversation summary, and optional UI context to AI services.

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
│   ├── main.py
│   ├── models.py
│   ├── schemas.py
│   ├── users.py
│   ├── routers/
│   │   ├── trip.py
│   │   ├── trip_days.py
│   │   ├── trip_points.py
│   │   ├── trip_details.py
│   │   ├── trip_import.py
│   │   ├── trip_ai_import.py
│   │   ├── chat.py
│   │   └── profile.py
│   └── services/
│       ├── new_trip_workflow.py
│       ├── trip_assistant_workflow.py
│       ├── prompt_composer.py
│       ├── trip_ai.py
│       └── ai_trace.py
├── pripritrip_system_prompt.md
├── ai.log
├── dev.sh
├── docker-compose.yml
├── init_db.py
└── tests/
```

## Tests

```bash
cd api
source .venv/bin/activate
pytest -q
```
