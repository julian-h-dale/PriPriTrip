#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PORT=8000
DB_PORT=5432
APP_PASSWORD="${APP_PASSWORD:-honeymoon}"

# ── cleanup ──────────────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo ""
  echo ">> Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  # Stop the db container started by docker compose
  (cd "$REPO_ROOT/api" && docker compose stop db) 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── helpers ───────────────────────────────────────────────────────────────────
wait_for_port() {
  local name="$1" port="$2" retries=30
  echo ">> Waiting for $name on port $port..."
  for i in $(seq 1 $retries); do
    if nc -z 127.0.0.1 "$port" 2>/dev/null; then
      echo "   $name is up."
      return 0
    fi
    sleep 1
  done
  echo "ERROR: $name did not start on port $port after ${retries}s." >&2
  exit 1
}

# ── 1. Start PostgreSQL ───────────────────────────────────────────────────────
echo ">> Starting PostgreSQL via Docker Compose..."
(cd "$REPO_ROOT/api" && docker compose up db -d)

wait_for_port "PostgreSQL" "$DB_PORT"

# ── 2. Run Alembic migrations ─────────────────────────────────────────────────
echo ">> Running Alembic migrations..."
(
  cd "$REPO_ROOT/api"
  if [[ -f .venv/bin/activate ]]; then
    # shellcheck source=/dev/null
    source .venv/bin/activate
  fi
  alembic upgrade head
)

# ── 3. Start FastAPI ──────────────────────────────────────────────────────────
echo ">> Starting FastAPI (port $API_PORT)..."
(
  cd "$REPO_ROOT/api"
  if [[ -f .venv/bin/activate ]]; then
    # shellcheck source=/dev/null
    source .venv/bin/activate
  fi
  uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT"
) &
PIDS+=($!)

wait_for_port "FastAPI" "$API_PORT"

# ── 4. Verify auth endpoint ───────────────────────────────────────────────────
echo ">> Verifying auth endpoint..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:${API_PORT}/auth" \
  -H "Content-Type: application/json" \
  -d "{\"password\": \"${APP_PASSWORD}\"}")

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "   Auth OK (HTTP 200)."
else
  echo "ERROR: Auth endpoint returned HTTP $HTTP_STATUS (expected 200)." >&2
  echo "       Check APP_PASSWORD env var — current value: '${APP_PASSWORD}'" >&2
  exit 1
fi

# ── 5. Start UI ───────────────────────────────────────────────────────────────
echo ">> Starting UI (npm run dev)..."
(
  cd "$REPO_ROOT/ui"
  npm run dev
)

