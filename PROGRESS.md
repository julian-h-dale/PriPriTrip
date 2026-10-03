# PROGRESS

> Resumable state so a dropped session can pick up where it left off. The agent
> updates this after every phase (and whenever meaningful progress is made).
> Keep it short and current.

## Status

- **Current work (2026-10-03):** **Run stage 2** ("find it fast",
  `implementation_plan.md`, Phases 20–24), built one commit per phase.
  - **Phase 20 ✅:** `/` lands on the active or next upcoming trip
    (`pickLandingTrip`), else `/trips`. The trips list moved to `/trips`,
    grouped Active / Upcoming / Past (collapsed), with delete behind a "⋯"
    `RowMenu`. A `TopBar` (☰) opens the `NavDrawer`: All trips, Install,
    Admin, Sign out. The "Times are local" line is gone, and the location
    links have 44px tap targets. The e2e `login()` helper now opens `/trips`
    itself.
  - **Phase 21 ✅:** a **Today** tab (`/trips/:id/today`, the first tab;
    landing opens it). It shows:
    - **Next up:** the next check-in, check-out, departure or timed
      activity, compared as instants across zones (`wallToInstant`), with
      "in 1 h 15 min", the confirmation number, Directions and View day;
    - **Tonight:** the stay, plus a morning check-out on a changeover day;
    - **the day's plan;**
    - **Tomorrow.**

    Outside the trip's dates it previews day 1 and says so (Julian wants it
    easy to test; hiding it outside the trip comes later). Past days are
    greyed on the timeline and today is marked. `shared/utils/mapsLinks.js`
    (`mapsUrl`, `directionsUrl`) is shared.
  - **Phase 22 ✅:** `EntryDetails` (in `features/timeline/EntryDetails.jsx`,
    with `ConfirmationNumber` and `PlaceRow`) is the one details layout for
    the day page's expanded entries, the stays/travel quick look and Today's
    plan. Order: facts (now with Room and Seat), confirmation number, notes,
    places. Photos are 64px thumbnails, with none for airports and stations.
  - **Phase 23 ✅:** trip search. 🔍 in the trip's top bar opens a
    full-screen `TripSearch` over `searchTrip`. It's on-device, ignores
    case and accents, needs every word, and covers titles, confirmation
    numbers, carrier and number, seat or room, notes (markdown stripped in
    snippets), places and day titles. Each booking is listed once, where it
    starts. A result links to `/trips/:id/days/:date?open=<entry key>`,
    which expands that entry and scrolls to it.
- **Earlier (2026-10-03):** Run stage 1 in `implementation_plan.md`,
  built as two commits, as Julian asked. **Both are done**, waiting on
  Julian's 375px look.
  - **Map place search (commit 2, Phases 16–17):**
    - The map's search shows the trip's own matches ("On this trip"), then
      Google Places autocomplete ("New places", each marked **New**),
      biased to the map's viewport. A place already on the trip is never
      shown twice.
    - Picking a new place drops a white "+" marker, zooms there and opens a
      React-rendered info window: photo, address, "Not in this trip", and
      the Add actions that fit the place (`placeActions`: lodging → Add stay;
      airports and stations → Travel from/to here; everything else → Add
      activity; the rest under More…). A city only pans.
    - An action opens the existing form prefilled with the place, on the date
      from `defaultFormDate` (the map's day filter, else today in the trip,
      else for a stay the first night without one, else the first day).
      Saving turns it into a normal trip marker.
  - **PWA and offline (commit 1, Phases 18–19):**
  - **PWA:** `vite-plugin-pwa` precaches the app shell (deep links open
    offline). It uses `registerType: "prompt"`, so an "Update available ·
    Reload" bar appears (`shared/pwa/`) and the app never reloads itself.
    Other pieces:
    - an "Install app" button on the trips page, with a Share → Add to Home
      Screen hint on iOS;
    - iOS meta tags and safe-area padding;
    - no-cache headers for `sw.js`, `index.html` and the manifest in
      `deploy/nginx.conf`.
    Install and offline need HTTPS, which comes with the Fly deploy (not done
    yet). Until then they're verified on `localhost`.
  - **Logo:** `docs/brand/logo.svg`. `make icons` regenerates
    `ui/public/{favicon.svg,pwa-*.png,maskable-512x512.png,apple-touch-icon.png}`
    with the preinstalled Chromium.
  - **Offline cache:** `shared/services/tripCache.js` (IndexedDB through
    `idb-keyval`), keyed by the user id in the JWT's `sub`, so it can be read
    offline.
    - The trips list and each trip are stale-while-revalidate: the saved copy
      renders first, then the server's copy replaces it.
    - Trips that haven't ended are cached in the background, and every edit
      updates the cache.
    - Offline, or with the server down, pages are **read-only** (edit
      controls disabled) and the `OfflineBar` shows "Offline · read-only ·
      saved copy from …". The map tab becomes a list of places with
      directions links.
    - Sign out clears that user's cache; an expired token (401) doesn't.
  - **Shared date lookups:** `shared/utils/tripDates.js` (`todayIn`,
    `isInTrip`, `tripPhase`). "Today" is the trip's own calendar day.
    Commit 2 adds `defaultFormDate`.
  - **The login now lasts 60 days** (`jwt_expiry_hours`).
  - **UI/UX review:** `ui_review.md` (not scheduled yet).
- **Phase 15** (map search & filters) and Phase 14
  (bottom nav & map view) are done and fully verified live — Julian
  created a Map ID. Phases 11–13 (day detail pages,
  stays/travel coverage views, location photos & mini-map previews) are done
  too. Tapping a day on the trip timeline now
  navigates to its own page (`/trips/:id/days/:date`) instead of expanding in
  place; the trip overview is pure read-at-a-glance (date, cities, title,
  summary), and all editing (activities, stays, travel, the day's own
  title/summary) lives on the day page. The day page has its own rail — one
  dot per entry, labeled by time instead of by date — reusing the exact rail
  visual from the trip page, plus prev/next day links. Two icon buttons
  (House, Plane) next to the trip title switch the whole trip overview into a
  coverage view: stays view colors each date's dot by which hotel covers
  that night (blank/muted if none); travel view colors by which booked leg
  touches that date, joining same-day legs into one label. Exactly one of
  plan/stays/travel is shown at a time.
  Selecting a covered date opens a new read-only `BookingDetailsDialog` quick
  look (name, dates, location with a mini-map, confirmation, notes) with an
  "Edit" button — it no longer jumps straight to the edit form. An uncovered
  date still opens the add form directly.
- A small, non-interactive Google map preview (`MiniMap`, centered on one
  point, no API key visible beyond the existing browser key) now shows in
  `PlaceField` once a place is picked, and in every `LocationBlock` (the
  day page's expanded entries, and the details dialog). The Maps JS
  bootstrap loader was factored out of `googlePlaces.js` into
  `googleMapsLoader.js` so both `places` and `maps`/`marker` libraries share
  one script tag.
- **Location photos:** `LocationDoc.imgRef` stores the first Google Places
  photo's resolved URL, captured whenever a place is picked anywhere in the
  app (stays, travel, activities all share `PlaceField`/`googlePlaces.js`).
  Shown now in `LocationBlock` (day page entries, the details dialog) and the
  map's info windows — a real photo there instead of the small static map,
  which wasn't pulling its weight next to one. The mini-map is still the
  fallback when a location has no photo, and still what `PlaceField` shows
  while picking.
  `make backfill-photos` fills imgRef in for locations that predate this
  feature — idempotent, run by hand, not wired into import. It handles
  locations with no `placeId` too (the common case — almost nothing in real
  trip data has one, since that's only ever set by the live Places picker):
  it resolves one via a Places text search on name + address/city first,
  then fetches the photo. Ran for real against the (freshly reseeded) sample
  trip: all 14 of its locations, none with a `placeId`, got a photo — spot-
  checked the riskiest generic names ("Bern") against the real photo
  returned. Earlier, live-verified against the real dev DB too (a real photo
  of
  the Okinawa trip's Palm Royal hotel came back).
- **Bottom nav & map view:** Timeline/Map tabs show only while viewing a
  trip. `/trips/:id/map` plots every located stay, travel endpoint and
  activity (`buildMapMarkers.js`), color- and emoji-coded by kind, using
  `AdvancedMarkerElement`, fitted to the trip's stays/activities (not
  travel's endpoints, which are often a continent away). Tapping a marker
  opens an info window with its photo, title, day, a link to that day, and a
  directions link. Julian created the Map ID (`GOOGLE_MAPS_MAP_ID` in
  `api/.env`); live-verified with Playwright — all 10 of the sample trip's
  markers present, correctly fitted to Bern/Wengen, info window working.
- **Map search & filters:** a search box on the map matches the trip's own
  (currently filtered) locations first, falling back to a one-shot Places
  text search only to pan the map for orientation — never adds anything.
  House (stays only) and Calendar (one day, native date input) filters
  combine. **Real bug found by live Playwright testing**: toggling a filter
  by detaching/reattaching existing markers (`element.map = null`/map)
  silently and permanently dropped one marker whenever two shared the exact
  same coordinates — routine for round trips (e.g. Chicago appears on both
  the outbound and return flight). Fixed by rebuilding marker elements from
  scratch on every filter change instead; verified stable across 3 full
  toggle cycles live.
- **Branch:** `rebuild`, pushed to `origin/rebuild`. Not merged to `main`.
- **Last verified:** 2026-10-03: `make verify` green (115 API + 159 UI
  tests). Plus `ui/e2e/offline.spec.js` live against a built app, and
  `ui/e2e/trip.spec.js`, including add-from-map, against the real Google
  APIs. The test entries it adds are deleted afterwards.
  Before that, 2026-10-02: `make verify` green (115 API + 97 UI tests),
  plus a live Playwright pass against the real dev app (see below). Julian
  confirmed live Google Places works with his key. In a real browser at
  375px:
  - collapsed day rows, opening a day, and no horizontal scroll (Phase 10);
  - editing a flight from its marker saves, and its zones stay Chicago →
    Zurich;
  - adding a stay with place search unavailable (no key yet) uses a typed name
    on the trip's clock.
- **Note:** trips imported before Phase 10 have no stored `city`, so their
  rows guess it from addresses and show nothing for bare names. A
  `make reset-db` (then restart `make dev`) reloads the sample with cities.
- **LAN access:** the dev servers can now be reached from another machine on
  the network, not just `localhost`. `ui/vite.config.js` binds all
  interfaces (`host: true`), `api/.env`'s `CORS_ORIGINS` lists the Pi's LAN
  IPs, and `ui/src/shared/config/appConfig.js`'s API-URL fallback derives
  from the page's own hostname instead of a hardcoded `localhost` — so it
  works the same from `localhost`, either LAN IP, or a future hostname. The
  Google Maps browser key is still referrer-restricted to `localhost:3000`
  in the Google Cloud console; Julian needs to add the LAN IPs there himself
  for live Places search to work off-host.
- **E2E (Playwright):** `ui/e2e/`, practical screenshot-first checks only
  (page views, basic clicking, no visual-diff baselines) — see
  `ui/e2e/README.md`. Not part of `make verify`; run with
  `cd ui && npm run test:e2e` against a running `make dev`.
- **Fixed in passing:** `LoginPage` was dispatching `fetchMe()` itself on top
  of `App.jsx`'s own token-change effect doing the same thing, racing two
  `GET /users/me` calls right after login. Found via e2e testing — harmless
  most of the time, but if the duplicate lost the race it could 401 and
  bounce a freshly-logged-in user straight back to `/login`. Removed the
  redundant call; `App.jsx`'s effect already covers it.

## What exists (by phase)

- **0, reset:** v1 wiped; `project-template` dropped in; v1 knowledge kept in
  `reference/` and `docs/lessons_learned.md`.
- **1, the trip document:** `api/app/trip_document.py` is the single source;
  `schema/trip.schema.json` is generated by `make schema` and a test catches
  drift. Stays and travel live at trip level; days hold activities.
- **2, import/read API:** `POST /trips/import` always creates a new trip and
  rejects with every error's path; plus `GET /trips`, `GET /trips/{id}`,
  `DELETE`, and a public `GET /schema/trip`. The seed loads the sample trip.
- **3, home screen:** the trip list, an import dialog (problems listed by
  path), and delete with confirmation.
- **4, timeline:** `buildTimeline` computes stay and travel markers at render
  time (never stored), merged by time around activities.
- **Extras:**
  - `make dev` runs the API and UI together.
  - The password field has an eye toggle.
- **5–6, activity editing:**
  - Create, replace, move and delete; a day's title and summary.
  - Validated by the same code as import; every edit returns the whole trip.
- **7, zones and bookings API:**
  - `api/app/zones.py` (tzfpy, offline) decides each time's clock, used by
    validation and the read model (`zone`, `departZone`, `arriveZone`).
  - Stay and travel CRUD; `GET /config` (Maps key) and
    `GET /timezone?lat&lng`.
  - Travel `from` is required; `boat`, `seat`, `roomType` and `placeId` added.
- **8, vertical timeline:** a rail of dates with a day card per date, and
  `?day=` deep links.
- **9, booking forms:**
  - `PlaceField` (Google search, pick, rename, a read-only "Times here are X
    time" line, and a typed fallback).
  - `TravelForm` (arrival warning, cross-zone summary) and `StayForm`.
  - `ActivityForm` on `PlaceField`.
  - Edit and Delete on markers; an Add menu per day.
- **10, collapsed day rows:**
  - The date strip is removed and days start collapsed.
  - A row shows the date, the cities (`dayCities.js`), and the bold title plus
    the summary.
  - `LocationDoc.city` is set from Google's `locality` (or `postal_town`) on
    pick. Without it, the city is guessed from the address.
- **11, day detail pages:**
  - `DayRow` (was `DayCard`): the trip page's collapsed row is now a plain
    link to `/trips/:id/days/:date`, nothing else.
  - `DayDetailPage`: that date's entries, add/edit/delete for activities,
    stays and travel, and the day's own title/summary — everything `DayCard`
    used to hold inline. Prev/next day links; a fallback for a date outside
    the trip.
  - `RailDot`: the dot-and-line rail factored out of the old `DayCard`,
    shared between the trip page's day rows and the day page's entry rows
    (one dot per entry, by time, instead of one per date).
  - `TimelineEntry` carries its own rail dot now (tone follows activity vs.
    marker) and is only ever rendered on the day page.
- **12, stays/travel coverage views:**
  - `coverageView.js`: `stayCoverage(trip)` — a stay covers the *night* of
    date D when its check-in date <= D < its check-out date, first stay
    claiming a date wins. `travelCoverage(trip)` — a date is covered by a
    leg's depart date, plus its arrival date too when it lands later;
    same-day legs join into one label, keeping the first leg's color.
  - A fixed 8-color categorical palette (`--series-1`..`8` in `index.css`,
    `bg-series-1`..`8` in Tailwind), the dataviz skill's dark-surface
    reference palette converted to this app's HSL token convention and
    re-validated with its script. Color is assigned by position (never by
    rank), with the hotel/leg name always shown as text too (not
    color-alone), since the app has no light theme to also validate.
  - `RailDot` no longer takes a fixed `tone` enum; it takes any `bg-*`
    color class, so the trip page's day rows can show a categorical color
    instead of just primary/warning/muted.
  - `DayRow` takes a `view` ("plan" | "stays" | "travel") and that date's
    `coverage` entry; `TripTimelinePage` holds the view as local state (not
    persisted) and computes both coverage maps once per trip load.
  - Selected view button uses the `default` (filled primary) variant, not
    `secondary` — needed to read clearly as "pressed" at icon-button size.
  - **Adding/editing a stay or leg moved off the day page, into these
    views.** Selecting a date in stays/travel view opens that stay/leg's
    edit form directly (or the add form, prefilled for that date, when
    there's none) — no more navigating to the day page first. A date with
    more than one travel leg (same-day connections are normal, unlike
    stays) falls back to the day page instead, where both are listed. The
    day page's Add button is now just "Add activity"; stays/travel markers
    already on a day are still edited/deleted from there as before.
    `runEdit.js` factors the thunk-dispatch-to-`{ok}`/`{errors}` helper
    shared by `TripTimelinePage` and `DayDetailPage`.

## Next

1. **Julian:** look at Phases 11–15 at phone width and confirm them — the
   Playwright screenshots in `ui/e2e/screenshots/` are a stand-in, not the
   gate. Phases 3, 4, 6, 8, 9 and 10 also have manual phone-width gates.
2. **Julian:** add the LAN IPs as allowed referrers on the Google Maps
   browser key (Google Cloud console) if he wants live Places search to work
   from a LAN address, not just `localhost:3000`.
3. `example-trip.json` (Julian's real upcoming Okinawa/Taipei trip) has been
   re-imported (after the 2026-10-02 `make reset-db` wiped it) and
   backfilled with real photos via the name-search path — done, in the dev
   database now.
4. **Julian:** look at Run stage 1 at 375px: map search, adding from the
   map, and offline (DevTools → Network → Offline). Then deploy to Fly
   (HTTPS), install it on the phone, and try it in airplane mode before the
   Okinawa trip (Oct 29).
5. **Next candidate:** `ui_review.md` items 1 and 2 (a today-aware Now/Next
   card, and key details without expanding), building on
   `shared/utils/tripDates.js`.
6. **Then, from the backlog:** editing the trip header; verification/gaps
   (rebuilt from `docs/lessons_learned.md`); merging `rebuild` into `main`;
   anything past Walk stage 3 (map search/filters was the last planned
   phase there) needs a fresh look at what's next.

## Moving to another machine

Everything needed to build and run is in git on `origin/rebuild`. Setup:

```bash
git clone git@github.com:julian-h-dale/PriPriTrip.git && cd PriPriTrip
git checkout rebuild
make setup      # venv + npm install; creates api/.env with a fresh JWT_SECRET
make seed       # seed users + the sample trip
make dev        # API :8000 + UI :3000
make verify     # should be green: 115 API + 159 UI tests
```

Tested with Python 3.12.3, Node 24.14 and npm 11.11.

**Not in git** (copy by hand if you want it):
- `reference/private/`: personal PDFs and notes from v1, plus backups of the
  old `api/.env` and `ui/.env.local`. The old OpenAI and Maps keys are in
  there; nothing in the rebuild uses them yet.
- `GOOGLE_MAPS_API_KEY` in `api/.env` (the key exists and works): `make
  setup` makes a fresh `api/.env` without it, so copy the key across by hand
  (or from the Google Cloud console). Its referrer restriction covers
  `http://localhost:3000/*`, so it works on any machine on that port.
- `api/data/app.db`: the dev database. It's disposable: `make reset-db`
  recreates it, and edits made in the dev UI are lost.
- Claude's per-machine memory notes. The decisions that matter are copied
  under "Working agreements" below.

## Working agreements (carry these to any machine or agent)

- **No Claude attribution in commits or PRs** (no `Co-Authored-By`,
  `Claude-Session` or "Generated with" lines). Julian, 2026-10-02.
- **Keep the forms hand-written.** Julian edits trip data through them as a
  deliberate check by eye; don't generate them from a schema.
- **No migrations yet.** Schema changes mean `make reset-db`; don't write
  Alembic or SQL migration scripts until a release is in sight.
- **Local-only, private repo.** Personal trip material in `reference/` is
  fine to keep in git.
- **AI/chat is out of scope** until the core timeline and editing are solid.
- **Stay on React 18** (the template's version) and build our own vertical
  timeline, not react-chrono. Decided 2026-10-02.
- **No timezone pickers.** A time's zone is inferred from its place; users
  only enter wall-clock times. Zones are computed on read
  (`api/app/zones.py`), never stored. Decided 2026-10-02.
- **Google Places runs in the browser**, with the key from `GET /config`. It's
  a browser key protected by website and API restrictions in Google's console;
  the server never calls Google. Decided 2026-10-02.
- **The template workflow:** plan → answer the open questions → one phase at a
  time, `make verify` green, update this file, commit.

## Notes / decisions

- v1 code lives on `main` (pre-rebuild) and `llm-translate`. Use it for
  knowledge, not code.
- Chat/AI and verification are out of scope until the core timeline is solid.
- Every import creates a new trip; invalid imports are rejected outright.
- **Gotcha:** after `make reset-db`, restart `make dev`. A running API keeps
  pooled connections to the deleted SQLite file, so logins and data silently
  disagree until it restarts.
- `ui/.env` doesn't exist (template `make env` only creates `api/.env`); the UI
  uses the defaults (:3000 → API :8000).
