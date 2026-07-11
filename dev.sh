#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PORT=8000
DB_PORT=5432
API_PID_FILE="$REPO_ROOT/.api.pid"

# ── argument parsing ──────────────────────────────────────────────────────────
KILL_DB=false
KILL_API=false

for arg in "$@"; do
  case "$arg" in
    --kill-db)  KILL_DB=true ;;
    --kill-api) KILL_API=true ;;
    *)
      echo "Unknown flag: $arg" >&2
      echo "Usage: $0 [--kill-db] [--kill-api]" >&2
      exit 1
      ;;
  esac
done

# ── --kill-db ─────────────────────────────────────────────────────────────────
if $KILL_DB; then
  echo ">> Stopping PostgreSQL container..."
  (cd "$REPO_ROOT/api" && docker compose stop db) && echo "   DB stopped." || echo "   DB was not running."
  exit 0
fi

# ── --kill-api ────────────────────────────────────────────────────────────────
if $KILL_API; then
  if [[ -f "$API_PID_FILE" ]]; then
    API_PID=$(cat "$API_PID_FILE")
    if kill "$API_PID" 2>/dev/null; then
      echo ">> Stopped FastAPI (PID $API_PID)."
    else
      echo ">> FastAPI PID $API_PID was not running."
    fi
    rm -f "$API_PID_FILE"
  else
    echo ">> No FastAPI PID file found; trying pkill..."
    pkill -f "uvicorn app.main:app" 2>/dev/null && echo "   Killed uvicorn." || echo "   uvicorn was not running."
  fi
  exit 0
fi

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

# ── 1. Start PostgreSQL (background, stays running after script exits) ────────
echo ">> Starting PostgreSQL via Docker Compose..."
(cd "$REPO_ROOT/api" && docker compose up db -d)

wait_for_port "PostgreSQL" "$DB_PORT"

# ── 2. Start FastAPI (background, stays running after script exits) ───────────
echo ">> Starting FastAPI (port $API_PORT)..."
(
  cd "$REPO_ROOT/api"
  if [[ -f .venv/bin/activate ]]; then
    # shellcheck source=/dev/null
    source .venv/bin/activate
  fi
  # Load .env so JWT_SECRET / OPENAI_API_KEY etc. reach the app.
  if [[ -f .env ]]; then
    export $(grep -v '^\s*#' .env | grep -v '^\s*$' | xargs)
  fi
  uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT"
) &
API_BG_PID=$!
echo "$API_BG_PID" > "$API_PID_FILE"
disown "$API_BG_PID"

wait_for_port "FastAPI" "$API_PORT"

# ── 3. Verify API health ──────────────────────────────────────────────────────
echo ">> Verifying API health endpoint..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/health")

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "   Health OK (HTTP 200)."
else
  echo "ERROR: /health returned HTTP $HTTP_STATUS (expected 200)." >&2
  exit 1
fi

# ── 4. Start UI (foreground — Ctrl-C stops only Vite) ────────────────────────
echo ""
echo ">> DB and API are running in the background."
echo "   Stop DB:  ./dev.sh --kill-db"
echo "   Stop API: ./dev.sh --kill-api"
echo ""
echo ">> Starting UI (npm run dev)  — Ctrl-C stops Vite only."
(
  cd "$REPO_ROOT/ui"
  npm run dev
)

