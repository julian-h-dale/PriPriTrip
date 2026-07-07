#!/usr/bin/env bash
# dev.sh — Start the local Postgres container, ensure the schema exists,
#           then start the API with hot-reload.
#
# By default the database is PERSISTED between runs.
#
# Usage:
#   ./dev.sh          # persist data + ensure schema + start
#   ./dev.sh --clean  # wipe the Postgres volume for a brand-new empty db
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CLEAN=false
if [[ "${1:-}" == "--clean" ]]; then
  CLEAN=true
fi

# ── 1. Activate venv ─────────────────────────────────────────────────────────
if [[ ! -f ".venv/bin/activate" ]]; then
  echo "ERROR: .venv not found. Run: python3 -m venv .venv && pip install -r requirements.txt"
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate

# ── 2. Load .env so DATABASE_URL is available to alembic ─────────────────────
if [[ -f ".env" ]]; then
  # Export only simple KEY=VALUE lines (skip comments and blanks)
  set -a
  # shellcheck disable=SC2046
  export $(grep -v '^\s*#' .env | grep -v '^\s*$' | xargs)
  set +a
fi

# ── 3. Wipe the database volume (optional, --clean) ──────────────────────────
if [[ "$CLEAN" == "true" ]]; then
  echo ""
  echo "▶ --clean: wiping Postgres volume for a fresh database..."
  docker compose down -v --remove-orphans
else
  echo ""
  echo "▶ Persisting existing database (use --clean to reset)."
fi

# ── 4. Start a fresh Postgres container ──────────────────────────────────────
echo ""
echo "▶ Starting Postgres..."
docker compose up -d db

# Wait until the DB is healthy
echo -n "  Waiting for Postgres to be ready"
until docker compose exec -T db pg_isready -U postgres -q 2>/dev/null; do
  echo -n "."
  sleep 1
done
echo " ready."

# ── 5. Create schema ─────────────────────────────────────────────────────────
echo ""
echo "▶ Ensuring schema exists..."
python3 init_db.py

# ── 6. Start API ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Starting API on http://localhost:8000 (Ctrl+C to stop)"
echo ""
uvicorn main:app --reload --host 0.0.0.0 --port 8000
