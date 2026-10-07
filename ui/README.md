# PriPriTrip UI

The phone app: React 18 + Vite, Redux Toolkit, Tailwind with shadcn-style
components, installable and offline as a PWA. In development it runs on
`http://localhost:3000` and talks to the API on `:8000`.

## Run it

From the repo root, with the API running (`make dev-api`, or `make dev` for
both):

```bash
make setup     # once: npm install (and the API's venv)
make dev-ui    # Vite dev server on VITE_UI_PORT (default 3000)
```

or `cd ui && npm run dev`. Sign in with a seed account (see the
[root README](../README.md#quick-start-local)).

### Where it finds the API

[src/shared/config/appConfig.js](src/shared/config/appConfig.js), first match wins:
1. In dev, `VITE_API_BASE_URL` from `ui/.env` (a worktree's own port).
2. `window.__APP_CONFIG__.apiBaseUrl` from `/runtime-config.js` (in the
   production image it's `/api`, same origin: [../deploy/runtime-config.js](../deploy/runtime-config.js)).
3. The page's own host on `:8000`, so it works opened over the LAN too.

`ui/.env` is optional ([.env.example](.env.example)): `VITE_API_BASE_URL`
and `VITE_UI_PORT`. Without it the defaults are `:8000` and `:3000`.

### On a phone

Over the LAN (`http://192.168.x.x:3000`) the app works, but there's no
service worker, so no install and no offline: browsers only allow those on
`https://` or `localhost`. Try offline and install on the deployed app, or
with a local build (see [e2e/README.md](e2e/README.md#offline--installable-app-offlinespecjs)).

## Build

```bash
npm run build      # -> dist/ (the service worker and precache included)
npm run preview    # serve dist/ on :4173
```

The production image builds this in its first stage (see the root
`Dockerfile`).

## Tests and lint

```bash
make test-ui       # vitest run (jsdom)
make lint-ui       # eslint
npm test           # vitest in watch mode
npm run test:e2e   # Playwright in a real browser at 375 px: see e2e/README.md
```

`make verify` runs the unit tests and lint, not Playwright. jsdom checks
behaviour, not looks, so a phase that changes a page also gets a look at
375 px (the e2e screenshots).

## Code layout

```
src/
  app/App.jsx, store.js       routes and the Redux store
  features/<area>/            one folder per area: its pages, components and slice
    trips/                      the trips list, import, landing
    timeline/                   the trip timeline, day pages, the edit forms
    today/                      Today: next up, tonight, today's plan
    entry/                      an activity's, stay's or leg's own page
    journal/                    memories and photos (with the offline outbox)
    map/                        the map, its search, filter and list
    search/                     trip search
    currency/ weather/ clocks/ packing/ documents/   the Trip tools
    sharing/                    share codes and members
    pointsOfInterest/           points of interest
    admin/ auth/                the Admin page; sign-in and passwords
  shared/
    components/                 the top bar, bottom nav, drawer, layouts; ui/ holds the shadcn-style parts
    services/apiClient.js       axios with the auth and error interceptors (offline-aware)
    services/tripCache.js       trips, journals and weather saved on the phone (IndexedDB)
    services/outbox.js          memories and photos waiting to upload (IndexedDB)
    analytics/                  usage analytics to Umami, with an offline queue
    pwa/                        install, updates, token refresh, outbox sync
    utils/                      time (wall-clock values), trip dates, links
```

Conventions: one Redux slice per feature; every API call through
`apiClient`; wall-clock times shown as written (never `dayjs(isoString)`
on one: see `shared/utils/time.js`); styling per
[../design_doc.md](../design_doc.md) (dark, 4 px radius, semantic colour
tokens).

## Offline, in short

- The app shell is precached by the service worker (vite-plugin-pwa).
- Trips, journals and weather are saved on the phone as they load, and
  trips that haven't ended are saved in the background.
- `network.online` drives the offline state: the amber bar, saved copies,
  the map's list, and no error toasts for reads.
- Memories and photos written offline wait in the outbox; photos upload on
  Wi-Fi when you say so.
- Analytics events wait in their own queue and are sent later with their
  time.

More: [../docs/photos.md](../docs/photos.md) for photos end to end.
