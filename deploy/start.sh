#!/usr/bin/env bash
# Entrypoint for the unified image: run nginx (public :8080) and the API
# (loopback :8000) together. nginx reverse-proxies /api/* to the API.
set -euo pipefail

# Persist SQLite on the mounted volume (Fly volume is mounted at /data).
mkdir -p /data

# Bring the schema up to date before serving (Alembic). A database created by
# the pre-Alembic build is recognised and stamped at the baseline, keeping
# its data — see api/app/migrate.py.
python -m app.migrate

# Seed the initial users + sample data. Idempotent: existing
# users are left untouched, so this is safe on every boot. Without this a fresh
# container (or a fresh volume) has an empty database and nobody can log in.
python -m app.seed

# nginx in the background; the API in the foreground so the container's
# lifecycle tracks the API process.
nginx -g 'daemon off;' &

# One worker: the app is async, so one process serves a family's traffic,
# and the machine has 512 MB. Each worker costs its own baseline memory, and
# the one-photo-at-a-time lock (services/photos.py) is per process — two
# workers could process two photos at once. Two 24 MP uploads together were
# what got workers killed for running out of memory.
exec gunicorn app.main:app \
  --worker-class uvicorn.workers.UvicornWorker \
  --workers 1 \
  --bind 127.0.0.1:8000
