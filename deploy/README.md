# Deployment — unified container on Fly.io

The whole app ships as **one** Docker image: the React UI compiled to static
assets, served by nginx, which reverse-proxies `/api/*` to a FastAPI process on
the loopback interface. One public port (`8080`), one deployable unit.

```
browser ──▶ nginx :8080 ──┬─▶ /            static UI (/var/www/html)
                          └─▶ /api/*  ──▶  gunicorn/uvicorn 127.0.0.1:8000
                                            (prefix stripped by nginx)
```

State is decoupled onto a Fly **volume** mounted at `/data`; SQLite writes to
`/data/app.db` (`DATABASE_URL` in `fly.toml`). The machine is disposable; the
volume is not.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` (repo root) | Multi-stage build: Node compiles the UI, Python runtime + nginx serve it. |
| `deploy/nginx.conf` | Single ingress on `:8080`; rewrite-and-strip `/api` → backend. |
| `deploy/start.sh` | Entrypoint: `mkdir -p /data`, seed the database, start nginx + gunicorn. |
| `deploy/runtime-config.js` | Overwrites the dev API base with same-origin `/api`. |
| `fly.toml` | Fly app config: port, volume mount, VM size, `DATABASE_URL`. |

## Build & run locally

```bash
make image           # docker build -t app:latest .
make run-container    # run on http://localhost:8080 with a throwaway JWT_SECRET
```

## Deploy with `fly deploy` (recommended)

```bash
# One-time setup
fly app create your-app-name                 # then set the name in fly.toml
fly volumes create data --size 1 --region <your-region>
fly secrets set JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')

# Ship it (builds Dockerfile, pushes, releases)
fly deploy
```

## CI: build, test & publish to GHCR

`.github/workflows/ci.yml` runs the full pipeline on every push to `main`, every
`v*` tag, and every pull request:

1. **`verify`** — `make setup` then `make verify` (backend ruff/mypy/pytest,
   frontend eslint/vitest) on Python 3.12 + Node LTS.
2. **`image`** — builds this `Dockerfile` with Buildx, boots the container and
   asserts `GET /api/health` responds, then (off pull requests) pushes to
   `ghcr.io/<owner>/<repo>`.

Tags are derived by `docker/metadata-action`: the branch/PR ref, the git SHA,
semver tags on `v*` releases, and `latest` on the default branch. The workflow
authenticates with the built-in `GITHUB_TOKEN` (`packages: write`), so no extra
secret is needed — just ensure the repository/org allows GitHub Actions to
publish packages. Pull requests build and smoke-test the image but never push.

## Alternative: pull a prebuilt image from a registry (GHCR)

Once CI has published the image, you can provision a machine directly from it
instead of building on deploy:

```bash
# 1. Namespace
fly app create your-app-name

# 2. State boundary (same region the machine will run in)
fly volumes create data --size 1 --app your-app-name --region <target-region>

# 3. Compute — pull from the registry, map the port, attach the volume
fly machine run ghcr.io/<username>/<repo>:latest \
  --app your-app-name \
  --port 8080:8080 \
  --volume data:/data \
  --env DATABASE_URL=sqlite+aiosqlite:////data/app.db \
  --region <target-region>
```

Set `JWT_SECRET` with `fly secrets set` before the machine serves traffic.

### Cost control

`shared-cpu-1x` / 512MB is the baseline for a single-user demo (nginx + Python).
Stopping the machine freezes compute billing, leaving only the small volume fee:

```bash
fly machine stop <machine-id>    # suspend compute billing
fly machine start <machine-id>   # resume
```

`fly.toml` also sets `auto_stop_machines` / `auto_start_machines` so idle
machines suspend and wake on the next request automatically.
