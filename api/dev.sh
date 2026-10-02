#!/usr/bin/env bash
set -euo pipefail
mkdir -p data

# The port comes from .env so it can differ per worktree (see
# scripts/new-worktree.sh). Read just that one key rather than sourcing the
# whole file — .env also holds seed credentials.
API_PORT="${API_PORT:-$(sed -n 's/^API_PORT=//p' .env 2>/dev/null | tail -1)}"

exec uvicorn app.main:app --host 0.0.0.0 --port "${API_PORT:-8000}" --reload
