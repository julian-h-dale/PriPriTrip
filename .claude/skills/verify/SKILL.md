---
name: verify
description: Build/launch/drive recipe for verifying PriPriTrip changes end-to-end (FastAPI backend + React UI).
---

# Verifying PriPriTrip

## Backend (api/)

Postgres runs via docker compose (container `api-db-1`, host port 5433) — usually already up; check `docker ps`. If not: `cd api && docker compose up -d`.

Boot the API (loads `.env` — has a real `OPENAI_API_KEY` and `JWT_SECRET`):

```bash
cd api && set -a && source .env && set +a && \
  nohup .venv/bin/uvicorn app.main:app --port 8000 > /tmp/uvicorn.log 2>&1 &
```

Get a token (superuser seeded by `dev.sh --clean`):

```bash
curl -s -X POST http://localhost:8000/auth/session -H 'Content-Type: application/json' \
  -d '{"email":"julian.h.dale@gmail.com","password":"honeymoon"}'   # → {token, mapsApiKey}
```

## Flows worth driving

- **Chat (SSE)**: `POST /chat/reply` returns `text/event-stream` — events `status` (per tool call), `delta` (assistant message tokens), `done` (final ChatReplyResponse payload), `error`. A `trip:new_trip` message with dates + destination + stay + travel exercises the whole tool loop against real OpenAI (~5s, cheap). Non-trip workflowName returns a hello-world `done` without calling OpenAI.
- **Persistence check**: `GET /chat/trips/{tripId}?workflowName=...` after a reply.
- **ai.log**: `tail api/ai.log` — every chat turn logs `chat.reply.received/context`, `ai.chat_loop.*`, `chat.reply.outcome`.

## Gotchas

- When reading SSE with Python urllib, use `resp.read1(n)` not `resp.read(n)` — `read(n)` blocks for a full buffer and skews event timing.
- Kill the server with `pkill -f "uvicorn app.main:app"`.
- Trip-scoped routes 404 (not 403) for foreign/missing trips by design.

## Frontend (ui/)

`npm run dev` (port 5173, proxies nothing — set `VITE_API_URL=http://localhost:8000`). `npm run lint`, `npx vitest run`, `npm run build` for CI parity only — not verification.
