# PriPriTrip

PriPriTrip is a trip-planning application with a React + Vite frontend and a FastAPI backend backed by PostgreSQL. Trips are recorded as days → points (activities, check-ins/outs, departures/arrivals) with first-class travel and stay detail records, and an AI chat assistant helps capture itineraries conversationally or from uploaded documents.

> **Status:** local development only. There is no live deployment; everything below runs on your machine.

## Architecture

```text
UI (React + Vite PWA)
        |
        | HTTP/JSON
        v
API (FastAPI + SQLAlchemy async)
        |                    \
        | SQL                 \  OpenAI structured outputs
        v                      v
PostgreSQL 16               OpenAI API
```

## Repository Layout

```text
PriPriTrip/
├── api/                                      # FastAPI backend (see api/README.md)
├── ui/                                       # React frontend
├── data/                                     # Example trips, fixtures, verify test cases
├── diagrams/                                 # Mermaid flow + ER diagrams
├── docs/                                     # Local document drop-zone (gitignored)
├── dev.sh                                    # One-command full-stack dev loop
├── review.md                                 # Full codebase review (2026-07) + improvement roadmap
├── pripritrip_llm_integration_requirements.md# LLM integration requirements (living doc)
├── timezones.md                              # Timezone/date-time handling design notes
├── trip.schema.json                          # Canonical trip import model (POST /trip/import)
├── enhance.md                                # Working enhancement notes
└── test-prompts.md                           # Manual chat-workflow test prompts
```

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.12+ |
| Node.js | 20+ |
| Docker / Docker Compose | recent |

## Quickstart

### Option A — everything at once

```bash
./dev.sh
```

Starts PostgreSQL (Docker) and the API in the background, then runs the Vite dev server in the foreground. `./dev.sh --kill-api` / `--kill-db` stop the background pieces.

First-time setup before running it:

```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in values (see api/README.md)
cd ../ui && npm install
```

### Option B — per service

```bash
# Backend (DB + schema + API)
cd api
./dev.sh          # keep DB data
./dev.sh --clean  # wipe DB, recreate schema, seed superuser

# Frontend
cd ui
npm run dev
```

URLs:
- API: http://localhost:8000 (Swagger at /docs)
- UI: http://localhost:3000

## Authentication

The backend uses JWT bearer auth via fastapi-users.

For local development, `api/dev.sh --clean` seeds a superuser:
- email: julian.h.dale@gmail.com
- password: honeymoon

## AI Workflows

PriPriTrip includes AI-assisted chat and import flows:
- **Tool-calling chat loop** (default, `CHAT_ASSISTANT_MODE=loop`) — the model records trip details by calling typed tools (trip/day/point/stay/travel CRUD, location resolution) and sees each result, so it can self-correct; a deterministic `verify_trip` checklist steers what it asks next. `CHAT_ASSISTANT_MODE=batch` falls back to the legacy one-shot workflows.
- AI itinerary/document extraction and enrichment endpoints (PDF/DOCX/XLSX upload) — one-shot structured outputs, which fit that job.

Prompt configuration is centralized in `api/pripritrip_system_prompt.md` (validated at startup); composition lives in `api/app/services/prompt_composer.py`. See `api/README.md` for the endpoint list and chat architecture details.

## AI Trace Logging

Structured JSONL AI traces are written to `api/ai.log` (gitignored, rotated).

```bash
cd api
./view_ai_log.sh        # pretty-printed via jq
./view_ai_log.sh -f     # follow
tail -f ai.log          # raw
```

## Tests

### Backend

```bash
cd api
source .venv/bin/activate
pytest -q
```

Test dependencies: `pip install -r requirements-dev.txt`. CI (`.github/workflows/ci.yml`) runs pytest + frontend lint/build on every push.

### Frontend

```bash
cd ui
npm run lint && npx vitest run && npm run build
```

## Documentation

- `api/README.md` — backend endpoints, env vars, prompt system, AI logging
- `review.md` — full codebase review with prioritized roadmap
- `diagrams/` — chat endpoint flow, AI document import flow, entity relationships
- `pripritrip_llm_integration_requirements.md` — LLM behavior requirements
- `timezones.md` — timezone handling design

## Deployment

None currently. The app is local-only while the design stabilizes. (`.github/workflows/deploy-swa.yml` is a leftover manual-trigger UI deploy from an earlier Azure prototype; the Azure Functions backend it paired with no longer exists.) Before any release: adopt Alembic migrations, pin dependencies, and revisit the security notes in `review.md` (1B-5).
