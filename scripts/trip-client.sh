#!/usr/bin/env bash
# List your trips, or export one as a trip document (JSON) — the backup, and
# the way to move a trip between environments (import the file there).
#
#   scripts/trip-client.sh list
#   scripts/trip-client.sh export <trip-id>
#
# Run through `make list-trips` / `make export-trip TRIP=<id>`. Settings (env):
#   TRIP_EMAIL, TRIP_PASSWORD  who to sign in as (the password is asked for
#                              when unset and a terminal is attached)
#   API_URL   the API to call; default http://localhost:<API_PORT from api/.env>.
#             The deployed app is behind /api: https://pripri-trip.fly.dev/api
#   OUT       export file; default exports/<trip-name>.json, "-" for stdout
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

cd "$(dirname "$0")/.."
command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required"

cmd="${1:-}"
case "$cmd" in
  list) ;;
  export) trip="${2:-}"; [ -n "$trip" ] || die "export needs a trip id (make export-trip TRIP=<id>; make list-trips shows them)" ;;
  *) die "usage: $0 list | export <trip-id>" ;;
esac

if [ -z "${API_URL:-}" ]; then
  port="$(sed -n 's/^API_PORT=//p' api/.env 2>/dev/null | head -1)"
  API_URL="http://localhost:${port:-8000}"
fi
API_URL="${API_URL%/}"

[ -n "${TRIP_EMAIL:-}" ] || die "set TRIP_EMAIL (and TRIP_PASSWORD) to sign in to $API_URL"
if [ -z "${TRIP_PASSWORD:-}" ]; then
  [ -t 0 ] || die "set TRIP_PASSWORD (no terminal to ask on)"
  read -r -s -p "Password for $TRIP_EMAIL: " TRIP_PASSWORD; echo >&2
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Sign in. The credentials go through files, not the process list.
printf '%s' "$TRIP_EMAIL" > "$tmp/email"
printf '%s' "$TRIP_PASSWORD" > "$tmp/password"
code="$(curl -sS -o "$tmp/login.json" -w '%{http_code}' -X POST "$API_URL/auth/login" \
  --data-urlencode "username@$tmp/email" --data-urlencode "password@$tmp/password" \
  2>"$tmp/err")" || die "could not reach $API_URL: $(cat "$tmp/err")"
[ "$code" = 200 ] || die "sign-in refused (HTTP $code): check TRIP_EMAIL and TRIP_PASSWORD for $API_URL"
printf 'header = "Authorization: Bearer %s"\n' \
  "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["access_token"])' "$tmp/login.json")" \
  > "$tmp/auth"

# GET a path into $tmp/body; fail with the server's message otherwise.
get() {
  code="$(curl -sS -K "$tmp/auth" -D "$tmp/headers" -o "$tmp/body" -w '%{http_code}' "$API_URL$1" \
    2>"$tmp/err")" || die "could not reach $API_URL: $(cat "$tmp/err")"
  if [ "$code" != 200 ]; then
    msg="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("detail",""))' "$tmp/body" 2>/dev/null || true)"
    die "HTTP $code from $1${msg:+: $msg}"
  fi
}

if [ "$cmd" = list ]; then
  get /trips
  python3 - "$tmp/body" <<'PY'
import json, sys
trips = json.load(open(sys.argv[1]))
if not trips:
    print("No trips.")
for t in trips:
    print(f"{t['id']}  {t['startDate']} to {t['endDate']}  {t['name']}  ({t['role']})")
PY
  exit 0
fi

get "/trips/$trip/export"
out="${OUT:-}"
if [ -z "$out" ]; then
  name="$(sed -n 's/^[Cc]ontent-[Dd]isposition:.*filename="\([^"]*\)".*/\1/p' "$tmp/headers" | head -1)"
  out="exports/${name:-trip-$trip.json}"
fi
if [ "$out" = "-" ]; then
  cat "$tmp/body"
else
  mkdir -p "$(dirname "$out")"
  cp "$tmp/body" "$out"
  echo "Exported to $out" >&2
fi
