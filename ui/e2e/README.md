# E2E (Playwright)

Practical, screenshot-first checks against a real running app, in Chromium
at phone width (375 × 812): page views and basic clicking, nothing more. No
visual-diff baselines (the UI is still changing a lot), so these stay light
on purpose. Not part of `make verify`; run them when a phase changes a page,
and look at the screenshots.

```bash
make seed                     # once: the specs use the sample trips
make dev                      # optional: Playwright starts the API and UI itself if they aren't running
cd ui
set -a; . ../api/.env; set +a # this machine's seed passwords (SEED_*_EMAIL / _PASSWORD)
npm run test:e2e              # everything
npx playwright test e2e/analytics.spec.js   # one spec
```

The specs sign in as the seed accounts, reading `SEED_USER_EMAIL` /
`SEED_USER_PASSWORD` (and the viewer's and admin's) from the environment,
with the `.env.example` defaults otherwise. If you've changed a seed
password locally, source `api/.env` as above or sign-in fails. The ports
come from `api/.env` and `ui/.env`, so a worktree's own are used.

Screenshots land in `e2e/screenshots/` (git-ignored), overwritten each run,
named by spec (`01-trips-list.png`, `18a-analytics-owner.png`, …).

| Spec | Checks |
|---|---|
| `trip.spec.js` | Trips list, landing, Today, search, timeline, day pages and swiping, entry pages, coverage views, the map (search, filters, List, adding places), sharing, viewers, two editors |
| `accounts.spec.js` | Invites, temporary passwords, resets, making someone an admin |
| `tools.spec.js` | Currency, Weather and Time zones from the drawer |
| `packing.spec.js`, `documents.spec.js` | Packing lists; documents upload and download |
| `journal-*.spec.js` | Memories, location, photos, writing offline |
| `offline-toasts.spec.js` | Offline in the browser: no error toasts anywhere |
| `analytics.spec.js` | What goes to Umami (a pretend Umami host, so nothing is counted for real), by role, and offline |
| `offline.spec.js` | The installed app offline: needs a build (below) |

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
