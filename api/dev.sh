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

SEED_EMAIL="julian.h.dale@gmail.com"
SEED_PASSWORD="honeymoon"
SEED_NAME="Julian Admin"
SEED_FIRST_NAME="Julian"
SEED_LAST_NAME="Dale"
SEED_HOME_LOCATION_NAME="Chicago, IL"
SEED_HOME_LOCATION_FULL_ADDRESS="Chicago, IL, USA"
SEED_HOME_LOCATION_LAT="41.8781"
SEED_HOME_LOCATION_LNG="-87.6298"
SEED_HOME_LOCATION_GOOGLE_PLACE_ID="ChIJ7cv00DwsDogRAMDACa2m4K8"
SEED_HOME_LOCATION_GOOGLE_MAPS_URI="https://maps.google.com/?q=Chicago,+IL"
SEED_HOME_TIMEZONE_ID="America/Chicago"
SEED_PHONE_NUMBER="555-0100"

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

# ── 6. Seed default superuser (only on --clean) ─────────────────────────────
if [[ "$CLEAN" == "true" ]]; then
  echo ""
  echo "▶ Seeding default superuser..."

  SEED_USER_ID="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"

  SEED_HASHED_PASSWORD="$(python3 - <<'PY'
from pwdlib import PasswordHash
print(PasswordHash.recommended().hash("honeymoon"))
PY
)"

  docker compose exec -T db psql -U postgres -d pripritrip \
    -v seed_user_id="$SEED_USER_ID" \
    -v seed_email="$SEED_EMAIL" \
    -v seed_name="$SEED_NAME" \
    -v seed_first_name="$SEED_FIRST_NAME" \
    -v seed_last_name="$SEED_LAST_NAME" \
    -v seed_home_location_name="$SEED_HOME_LOCATION_NAME" \
    -v seed_home_location_full_address="$SEED_HOME_LOCATION_FULL_ADDRESS" \
    -v seed_home_location_lat="$SEED_HOME_LOCATION_LAT" \
    -v seed_home_location_lng="$SEED_HOME_LOCATION_LNG" \
    -v seed_home_location_google_place_id="$SEED_HOME_LOCATION_GOOGLE_PLACE_ID" \
    -v seed_home_location_google_maps_uri="$SEED_HOME_LOCATION_GOOGLE_MAPS_URI" \
    -v seed_home_timezone_id="$SEED_HOME_TIMEZONE_ID" \
    -v seed_phone_number="$SEED_PHONE_NUMBER" \
    -v seed_hash="$SEED_HASHED_PASSWORD" <<'SQL'
INSERT INTO users (
  id,
  email,
  hashed_password,
  is_active,
  is_superuser,
  is_verified,
  name,
  first_name,
  last_name,
  home_location_name,
  home_location_full_address,
  home_location_lat,
  home_location_lng,
  home_location_google_place_id,
  home_location_google_maps_uri,
  home_timezone_id,
  phone_number
)
VALUES (
  :'seed_user_id'::uuid,
  :'seed_email',
  :'seed_hash',
  true,
  true,
  true,
  :'seed_name',
  :'seed_first_name',
  :'seed_last_name',
  :'seed_home_location_name',
  :'seed_home_location_full_address',
  :'seed_home_location_lat'::double precision,
  :'seed_home_location_lng'::double precision,
  :'seed_home_location_google_place_id',
  :'seed_home_location_google_maps_uri',
  :'seed_home_timezone_id',
  :'seed_phone_number'
)
ON CONFLICT (email)
DO UPDATE SET
  hashed_password = EXCLUDED.hashed_password,
  is_active = true,
  is_superuser = true,
  is_verified = true,
  name = EXCLUDED.name,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  home_location_name = EXCLUDED.home_location_name,
  home_location_full_address = EXCLUDED.home_location_full_address,
  home_location_lat = EXCLUDED.home_location_lat,
  home_location_lng = EXCLUDED.home_location_lng,
  home_location_google_place_id = EXCLUDED.home_location_google_place_id,
  home_location_google_maps_uri = EXCLUDED.home_location_google_maps_uri,
  home_timezone_id = EXCLUDED.home_timezone_id,
  phone_number = EXCLUDED.phone_number;
SQL

  echo "  Seeded user: $SEED_EMAIL (superuser=true)"
fi

# ── 7. Start API ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Starting API on http://localhost:8000 (Ctrl+C to stop)"
echo ""
uvicorn main:app --reload --host 0.0.0.0 --port 8000
