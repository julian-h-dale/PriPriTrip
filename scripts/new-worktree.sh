#!/usr/bin/env bash
# ==============================================================================
# new-worktree.sh
#
# Spin up an isolated worktree so a second (or third) idea can be built and run
# in parallel without disturbing the main checkout. Each worktree gets:
#
#   * its own directory, in a container folder beside the repo:
#         <repo>/../<repo-name>-worktrees/<slug>/
#   * its own fresh branch, cut from main
#   * its own api/.env + ui/.env, copied from the main checkout (so JWT secret
#     and seed credentials match) with the ports rewritten
#   * its own port pair — slot N is API 8000+N / UI 3000+N; the main checkout
#     is slot 0
#   * its own SQLite database, api/data/app-<slug>.db, freshly seeded
#
# Usage (from anywhere inside the repo or one of its worktrees):
#     bash scripts/new-worktree.sh billing
#     bash scripts/new-worktree.sh feat/billing --from v2
#     bash scripts/new-worktree.sh spike --no-setup
#
# Options:
#     --from <ref>     Base the branch on <ref> instead of main
#     --api-port <n>   Force the API port (skips slot allocation)
#     --ui-port <n>    Force the UI port (skips slot allocation)
#     --no-setup       Skip `make setup` (implies --no-seed)
#     --no-seed        Skip `make seed`
#
# Override the container folder with WORKTREE_ROOT=/some/path.
# Tear one down with scripts/rm-worktree.sh.
# ==============================================================================
set -euo pipefail

BASE_REF="main"
API_PORT=""
UI_PORT=""
RUN_SETUP=1
RUN_SEED=1
NAME=""

die() { echo "error: $*" >&2; exit 1; }

# --- args ---------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)     BASE_REF="${2:-}"; shift 2 ;;
    --api-port) API_PORT="${2:-}"; shift 2 ;;
    --ui-port)  UI_PORT="${2:-}";  shift 2 ;;
    --no-setup) RUN_SETUP=0; RUN_SEED=0; shift ;;
    --no-seed)  RUN_SEED=0; shift ;;
    -h|--help)  sed -n '2,30p' "$0" | sed 's/^# \?//'; exit 0 ;;
    -*)         die "unknown option: $1" ;;
    *)
      [[ -n "$NAME" ]] && die "unexpected argument: $1 (name already given as '$NAME')"
      NAME="$1"; shift ;;
  esac
done

[[ -n "$NAME" ]] || die "usage: bash scripts/new-worktree.sh <name> [--from <ref>] [--no-setup]"

# --- locate the MAIN checkout -------------------------------------------------
# --git-common-dir (not --show-toplevel) so this works when run from inside an
# existing worktree: it always points at the main repo's .git.
git rev-parse --git-common-dir >/dev/null 2>&1 || die "not inside a git repository."
GIT_COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
MAIN_REPO="$(dirname "$GIT_COMMON_DIR")"
REPO_NAME="$(basename "$MAIN_REPO")"
WORKTREE_ROOT="${WORKTREE_ROOT:-$(dirname "$MAIN_REPO")/${REPO_NAME}-worktrees}"

# --- names --------------------------------------------------------------------
BRANCH="$NAME"
# Directory slug: lowercase, everything but [a-z0-9] collapsed to a single dash.
SLUG="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9]\+/-/g' -e 's/^-//' -e 's/-$//')"
[[ -n "$SLUG" ]] || die "'$NAME' does not reduce to a usable directory name."
WT_DIR="${WORKTREE_ROOT}/${SLUG}"

git -C "$MAIN_REPO" show-ref --verify --quiet "refs/heads/${BRANCH}" \
  && die "branch '${BRANCH}' already exists. Pick another name, or remove it first."
[[ -e "$WT_DIR" ]] && die "directory already exists: $WT_DIR"

# --- resolve the base ref -----------------------------------------------------
if ! git -C "$MAIN_REPO" rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  if git -C "$MAIN_REPO" rev-parse --verify --quiet "origin/${BASE_REF}^{commit}" >/dev/null; then
    BASE_REF="origin/${BASE_REF}"
  else
    die "base ref '${BASE_REF}' not found locally or on origin. Pass --from <ref>."
  fi
fi

# Warn (don't block) when the local base is behind its upstream — branching off
# a stale main is a quiet way to lose an afternoon.
if UPSTREAM="$(git -C "$MAIN_REPO" rev-parse --verify --quiet "origin/${BASE_REF}^{commit}" 2>/dev/null)"; then
  BEHIND="$(git -C "$MAIN_REPO" rev-list --count "${BASE_REF}..${UPSTREAM}" 2>/dev/null || echo 0)"
  [[ "$BEHIND" != "0" ]] && echo "note: local ${BASE_REF} is ${BEHIND} commit(s) behind origin/${BASE_REF}."
fi

# --- port allocation ----------------------------------------------------------
port_in_use() {
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${1}\$"
}

# Slots already claimed by existing worktrees, read from their api/.env.
# The main checkout is always slot 0 (8000/3000).
claimed_slots() {
  echo 0
  git -C "$MAIN_REPO" worktree list --porcelain \
    | sed -n 's/^worktree //p' \
    | while read -r wt; do
        [[ -f "${wt}/api/.env" ]] || continue
        p="$(sed -n 's/^API_PORT=//p' "${wt}/api/.env" | tail -1)"
        [[ "$p" =~ ^[0-9]+$ ]] && echo $(( p - 8000 ))
      done
}

if [[ -z "$API_PORT" || -z "$UI_PORT" ]]; then
  mapfile -t TAKEN < <(claimed_slots | sort -n -u)
  slot=1
  while :; do
    [[ $slot -gt 200 ]] && die "no free port slot found below 200."
    if printf '%s\n' "${TAKEN[@]}" | grep -qx "$slot" \
       || port_in_use $(( 8000 + slot )) || port_in_use $(( 3000 + slot )); then
      slot=$(( slot + 1 )); continue
    fi
    break
  done
  API_PORT="${API_PORT:-$(( 8000 + slot ))}"
  UI_PORT="${UI_PORT:-$(( 3000 + slot ))}"
fi

echo "Creating worktree"
echo "  branch     ${BRANCH}   (from ${BASE_REF})"
echo "  directory  ${WT_DIR}"
echo "  API port   ${API_PORT}"
echo "  UI port    ${UI_PORT}"
echo "  database   api/data/app-${SLUG}.db"
echo

# --- create it ----------------------------------------------------------------
mkdir -p "$WORKTREE_ROOT"
git -C "$MAIN_REPO" worktree add -b "$BRANCH" "$WT_DIR" "$BASE_REF"

# --- env files ----------------------------------------------------------------
# Rewrite (or append) KEY=value without disturbing the rest of the file.
set_env_key() {
  local file=$1 key=$2 value=$3 tmp
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" '$0 ~ "^"k"=" {print k"="v; next} {print}' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    # Make sure we don't glue onto an unterminated last line.
    [[ -s "$file" && -n "$(tail -c 1 "$file")" ]] && printf '\n' >>"$file"
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

seed_env() {  # seed_env <relative path>
  local rel=$1
  if [[ -f "${MAIN_REPO}/${rel}" ]]; then
    cp "${MAIN_REPO}/${rel}" "${WT_DIR}/${rel}"
    echo "  ${rel}  (copied from the main checkout)"
  else
    cp "${WT_DIR}/${rel}.example" "${WT_DIR}/${rel}"
    echo "  ${rel}  (from ${rel}.example — main checkout had none)"
  fi
}

echo "Writing env files..."
seed_env "api/.env"
seed_env "ui/.env"

# Keep the main checkout's *hosts* (e.g. its LAN address, so the worktree is
# reachable from another machine too) and swap in this worktree's ports.
# Overwriting them with localhost broke LAN access: the browser on another
# machine would call ITS OWN localhost, and CORS would refuse the LAN origin.
env_value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1; }
MAIN_UI_PORT="$(env_value "${WT_DIR}/ui/.env" VITE_UI_PORT)"; MAIN_UI_PORT="${MAIN_UI_PORT:-3000}"
MAIN_CORS="$(env_value "${WT_DIR}/api/.env" CORS_ORIGINS)"
MAIN_API_URL="$(env_value "${WT_DIR}/ui/.env" VITE_API_BASE_URL)"

CORS="http://localhost:${UI_PORT}"
IFS=',' read -r -a origins <<<"${MAIN_CORS}"
for origin in "${origins[@]}"; do
  origin="$(echo "$origin" | sed -E "s#:${MAIN_UI_PORT}\$#:${UI_PORT}#")"
  [[ -n "$origin" && ",${CORS}," != *",${origin},"* ]] && CORS="${CORS},${origin}"
done
if [[ -n "$MAIN_API_URL" ]]; then
  API_URL="$(echo "$MAIN_API_URL" | sed -E "s#:[0-9]+/?\$#:${API_PORT}#")"
else
  API_URL="http://localhost:${API_PORT}"
fi

set_env_key "${WT_DIR}/api/.env" "API_PORT"     "${API_PORT}"
set_env_key "${WT_DIR}/api/.env" "CORS_ORIGINS" "${CORS}"
set_env_key "${WT_DIR}/api/.env" "DATABASE_URL" "sqlite+aiosqlite:///./data/app-${SLUG}.db"
set_env_key "${WT_DIR}/ui/.env"  "VITE_API_BASE_URL" "${API_URL}"
set_env_key "${WT_DIR}/ui/.env"  "VITE_UI_PORT"      "${UI_PORT}"

# The API refuses to boot without a JWT_SECRET, and the copied .env may not have
# a live one (it can be absent, empty, or commented out). Generate one rather
# than handing over a worktree that cannot start.
if ! grep -qE '^JWT_SECRET=.+' "${WT_DIR}/api/.env"; then
  set_env_key "${WT_DIR}/api/.env" "JWT_SECRET" \
    "$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  echo "  api/.env  (generated a JWT_SECRET — the source .env had none)"
fi

# --- install + seed -----------------------------------------------------------
if [[ "$RUN_SETUP" == "1" ]]; then
  echo
  echo "Installing dependencies (make setup) — this takes a minute or two..."
  make -C "$WT_DIR" setup
fi

if [[ "$RUN_SEED" == "1" ]]; then
  echo
  echo "Seeding the database..."
  make -C "$WT_DIR" seed
fi

# --- done ---------------------------------------------------------------------
cat <<EOF

Worktree ready.

  cd ${WT_DIR}
  make dev-api          # http://localhost:${API_PORT}
  make dev-ui           # http://localhost:${UI_PORT}

Start a coding session there with:

  cd ${WT_DIR} && claude
EOF

if [[ "$RUN_SETUP" != "1" ]]; then
  echo
  echo "Dependencies were NOT installed. Run 'make setup && make seed' in the worktree first."
fi

echo
echo "Remove it later with:  bash scripts/rm-worktree.sh ${SLUG}"
