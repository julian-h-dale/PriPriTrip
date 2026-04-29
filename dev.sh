#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONN="UseDevelopmentStorage=true"
FUNC_PORT=7071
AZURITE_PORT=10000
APP_PASSWORD="${APP_PASSWORD:-honeymoon}"

# ── cleanup ──────────────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo ""
  echo ">> Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
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

# ── 1. Start Azurite ──────────────────────────────────────────────────────────
AZURITE_DIR="/tmp/azurite-pripritrip"
mkdir -p "$AZURITE_DIR"
echo ">> Starting Azurite (data in $AZURITE_DIR)..."
azurite --silent --skipApiVersionCheck \
  --location "$AZURITE_DIR" \
  --debug /dev/null &
PIDS+=($!)

wait_for_port "Azurite" "$AZURITE_PORT"

# ── 2. Create containers (idempotent) ────────────────────────────────────────
echo ">> Ensuring blob containers exist..."
az storage container create --name trip      --connection-string "$CONN" --output none 2>/dev/null || true
az storage container create --name documents --connection-string "$CONN" --output none 2>/dev/null || true

# ── 3. Upload trip.json ───────────────────────────────────────────────────────
echo ">> Uploading data/trip.json..."
az storage blob upload \
  --container-name trip \
  --name trip.json \
  --file "$REPO_ROOT/data/trip.json" \
  --connection-string "$CONN" \
  --overwrite \
  --output none

# ── 4. Start Azure Functions ──────────────────────────────────────────────────
echo ">> Starting Azure Function (port $FUNC_PORT)..."
(
  cd "$REPO_ROOT/function"
  if [[ -f .venv/bin/activate ]]; then
    # shellcheck source=/dev/null
    source .venv/bin/activate
  fi
  func start
) &
PIDS+=($!)

wait_for_port "Azure Functions" "$FUNC_PORT"

# ── 5. Verify auth endpoint ───────────────────────────────────────────────────
echo ">> Verifying auth endpoint..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:${FUNC_PORT}/api/auth" \
  -H "Content-Type: application/json" \
  -d "{\"password\": \"${APP_PASSWORD}\"}")

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "   Auth OK (HTTP 200)."
else
  echo "ERROR: Auth endpoint returned HTTP $HTTP_STATUS (expected 200)." >&2
  echo "       Check APP_PASSWORD env var — current value: '${APP_PASSWORD}'" >&2
  exit 1
fi

# ── 6. Start UI ───────────────────────────────────────────────────────────────
echo ">> Starting UI (npm run dev)..."
(
  cd "$REPO_ROOT/ui"
  npm run dev
)
