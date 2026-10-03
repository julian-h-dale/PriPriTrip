# E2E (Playwright)

Practical, screenshot-first checks against a real running app: page views and
basic clicking, nothing more. No visual-diff baselines — the UI is still
changing a lot, so these stay light on purpose. Not part of `make verify`;
run them yourself when you want to see the app without being at a screen.

```bash
make dev              # if not already running
cd ui && npm run test:e2e
```

Screenshots land in `e2e/screenshots/` (gitignored), overwritten each run:
`01-trips-list.png`, `02-trip-timeline.png`, `03-day-detail.png`,
`04-day-detail-entry-expanded.png`.

Runs against the seeded sample trip ("Bern & Wengen Long Weekend"), so
`make seed` must have run at least once. Logs in as the seed dev user
(`SEED_USER_EMAIL`/`SEED_USER_PASSWORD` env vars, defaulting to the same
values `api/.env` ships with).

## Offline / installable app (`offline.spec.js`)

The service worker only runs in a built app, so this spec is skipped unless
`PREVIEW_URL` points at one. With `make dev` already holding :8000/:3000, run
a second API whose CORS allows the preview, point the build at it, and serve
the build:

```bash
cd api && . .venv/bin/activate && CORS_ORIGINS=http://localhost:4173 \
  uvicorn app.main:app --port 8100 &                  # second API, same dev DB
cd ui && npm run build \
  && echo 'window.__APP_CONFIG__ = { apiBaseUrl: "http://localhost:8100" };' > dist/runtime-config.js \
  && npx vite preview --port 4173 &
PREVIEW_URL=http://localhost:4173 npx playwright test e2e/offline.spec.js
```

It checks the manifest and icons, then loads trips online, switches the
browser offline, and reloads the trips list, a timeline, a trip that was
never opened (cached in the background because it hasn't ended), a day page
and the map tab from the cache. Screenshots: `10-offline-trips.png` to
`13-offline-map.png`.
