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

## Installable app (PWA) and offline

The UI is a PWA: it can be installed on a phone, and trips work offline (the
app shell is cached by the service worker, and trip data by the app in
IndexedDB). Browsers only allow a service worker in a **secure context**:
`https://…`, or `http://localhost`. A plain-HTTP LAN address
(`http://192.168.x.x:3000`) gets no install and no offline. Fly serves HTTPS
automatically, so the deployed app is installable as-is.

After the first deploy:
- Add the Fly hostname (`https://<app>.fly.dev/*`) to the Google Maps
  browser key's allowed referrers in the Google Cloud console, and set
  `GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_MAP_ID` as Fly secrets.
- `deploy/nginx.conf` serves `sw.js`, `index.html`, the manifest and
  `runtime-config.js` with `Cache-Control: no-cache`, so an installed app
  picks up a new release (the app then offers "Update available · Reload").

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
It runs **one** gunicorn worker (`start.sh`), so only one photo is processed at
a time. Photo processing peaks at about 100 MB (measured: 12, 24 and 48 MP
JPEGs). If uploads ever get `Out of memory: Killed process (gunicorn)` in
`fly logs`, go to 1 GB: set `memory = "1gb"` under `[[vm]]` in `fly.toml`
and deploy (`fly scale memory` alone is undone by the next deploy). Full-size HEIC photos are
the case to watch, since they can't be decoded smaller.
Stopping the machine freezes compute billing, leaving only the small volume fee:

```bash
fly machine stop <machine-id>    # suspend compute billing
fly machine start <machine-id>   # resume
```

`fly.toml` also sets `auto_stop_machines` / `auto_start_machines` so idle
machines suspend and wake on the next request automatically.
