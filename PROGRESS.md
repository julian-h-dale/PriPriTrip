# PROGRESS

> Resumable state so a dropped session can pick up where it left off. The agent
> updates this after every phase (and whenever meaningful progress is made).
> Keep it short and current.

## Status

- **Current work (2026-10-04): Run stages 6 and 7** on branch
  **`run-stage-6`** (off `main` after PR #8). Plan: `implementation_plan.md`,
  "Run stage 6" and "Run stage 7".
  - **Phase 37 ✅ (places in the trip files):** `make backfill-photos` on
    the dev database, then `placeId`/`imgRef` copied into
    `example-trip.json`, `sample_trip.json` and `demo_trip.py`.
    **Julian:** spot-check "Bern", "Wengen", "Syntagma" and "Athens
    Airport" (matched by text search).
  - **Phase 38 ✅ (map filters and pins):** Journal (memories only) and
    House (stays only) are either-or, with memories hidden by default; the
    Calendar narrows either. Pins use Lucide outline icons (vanilla
    `lucide` package, SVG data URL as `glyphSrc`). **Julian:** look at the
    pins at phone width.
  - **Phase 39 ✅ (swipe between days):** Embla 8.6.0 (+ auto-height). The
    slide follows the finger; settling replaces the URL; the arrow keys
    work on desktop; the prev/next links are gone. **Julian, on a real
    phone:** swiping feels right, and vertical scrolling never changes day.
  - **Phase 40 ✅ (editors):** an edit code (`trips.edit_code`, migration
    **0005**) beside the view code (the trip id) in the Share dialog;
    joining with it makes an editor. Editors pass `get_editable_trip`;
    deleting the trip and managing members stay owner-only.
    **Deploying:** start.sh migrates, so `fly deploy` applies 0005.
  - **Next:** Phase 41 (versions and 409, API). Julian said to carry on
    through the phases without waiting, unless there are questions.
  - **Run stage 7 (editors, versions, 409 conflicts):** planned, and the
    open questions were answered 2026-10-04: an editor join code, editors
    can delete, a conflict is an error and a reload (no merge), a missing
    version is refused, and details show "Edited by …".
- **Storage (2026-10-04):** SQLite and photos share the one 1 GB Fly volume.
  Plan: `fly volumes extend` before the trip. After the trip, maybe move
  photos to object storage (Tigris or R2; `photo_store.py` is ready for a
  new class). Neon would only take the database; it has no object storage.
- **Run stage 5 (2026-10-03)** on branch **`run-stage-5`**
  (off `main`, which has Run stage 4 merged (PR #7) and is deployed to Fly).
  Main checkout, ports 8000/3000. Plan: `implementation_plan.md`, "Run
  stage 5".
  - **Fixed first (baseline was flaky):** outbox queue times are strictly
    increasing, so photos picked together upload in the order picked
    (`Photos.test.jsx` failed about 1 run in 5).
  - **Phase 34 ✅ (Take photo):** a "Take photo" button beside "Add photos"
    (`capture="environment"`, one shot). Recent Android opened only the
    gallery for "Add photos". **Waiting on Julian:** try it on a real phone.
    Deployed to Fly from `run-stage-5`.
  - **Phase 35 ✅ (staying signed in):** `POST /auth/refresh`
    (`routers/auth_refresh.py`) swaps a valid token for a fresh 60-day one.
    `useTokenRefresh` (in App) calls it on start and on returning to the
    foreground, online, when the token is over a day old. Failures are
    quiet and keep the old token.
  - **Phase 36 ✅ (photos wait for Upload):** `syncOutbox` skips `addPhoto`
    unless `{ photos: true }` (`uploadPhotos`). An upload bar on the
    Journal shows the count, size and progress, plus the camera-roll
    warning. "Save to phone" (share sheet, or download) is in the viewer
    for waiting photos. There's a stronger sign-out warning, and
    `storage.persist()` at startup.
    Fixed: a memory with waiting photos could vanish on reconnect.
  - Phases 35–36 deployed to Fly from `run-stage-5`.
  - **Fix (2026-10-04): out-of-memory kills on photo upload.** Photo
    processing held several full-size decoded copies (+344 MB for a 24 MP
    photo) and 2 workers shared 512 MB. Now it's a leaner pipeline (decode
    JPEGs smaller, shrink before rotating, no extra copies: 24 MP +66 MB)
    and **1 worker**. 1 GB is held in reserve: do it before the trip if
    `fly logs` shows any `Out of memory` kill. Details in
    `implementation_plan.md` ("Fix (2026-10-04)").
  - **`fly.toml`:** `min_machines_running = 1` (Julian's change, committed
    2026-10-04).
  - **No seeding on boot (2026-10-04):** `deploy/start.sh` only migrates.
    The seed replants the sample and demo trips (deleting their memories
    and photos), so it's now only `make seed-remote`, on purpose.
  - **Photo viewer:** tapping the photo (or the space around it) closes it.
  - **Waiting on Julian:** on a real phone: Take photo, the warning, Save to
    phone, Upload on Wi-Fi.
  - **Live on Fly, still to do (Julian):** `fly volumes extend` (the volume
    is 1 GB and photos are live) and the `SEED_*` secrets (none set, so the
    seed accounts likely have their default passwords).
- **Run stage 4 (2026-10-03)** on the **`journal-memories`
  worktree** (`../PriPriTrip-worktrees/journal-memories`, a branch stacked
  on `rebuild`; API :8001, UI :3001). Merged to `main` (PR #7) and deployed.
  - **Phase 29 ✅:**
    - `POST /trips/{id}/memories` takes the phone's `id` and `createdAt`
      (with an offset or Z). A retry with the same id gives 200 with the
      saved memory; another user's, another trip's or a deleted memory's
      id gives 409.
    - The phone's time orders the journal, and `received_at` keeps the
      server's arrival stamp. A time more than 10 minutes ahead is clamped.
  - **Phase 29a ✅ (Alembic):**
    - Baseline 0001 is the schema as deployed from `rebuild`; 0002 adds
      `received_at`, backfilled from `created_at`.
    - `app/migrate.py` stamps a pre-Alembic database at 0001, then upgrades
      it (checked against a database made by the real `rebuild` checkout).
    - start.sh, dev.sh and the seed migrate. The app no longer calls
      `create_all`. The Dockerfile copies the migrations.
    - `make reset-db` now deletes the database `DATABASE_URL` names (it used
      to hardcode `app.db`, missing worktree databases).
  - **Phase 30 ✅ (the outbox):**
    - `shared/services/outbox.js` (IndexedDB): one merged entry per memory
      (create+edit is a create; create+delete is nothing).
    - `journalSlice` writes locally first (the phone's id and `createdAt`),
      then `syncOutbox`. Server rejections (404/409/422) are dropped with a
      toast; network errors, 5xx and 401 retry later.
    - `useOutboxSync` (in App) syncs on start, on reconnect, on returning to
      the foreground, and every 30 s while anything waits.
    - Memories show "Waiting to sync". Signing out with unsynced memories
      warns first, and a confirmed sign-out clears the outbox.
    - The offline bar no longer says "read-only". Playwright reads this
      checkout's ports.
    - The worktree's database also has the Okinawa trip (imported from
      `example-trip.json`) so the landing e2e has an upcoming trip.
  - **Phase 31 ✅ (location and the blue dot):**
    - Memories carry `location {lat, lng, accuracy}` (migration 0003).
    - The dialog's chip is on by default: it locates on open if already
      allowed, else the browser asks on Save. Saving waits about 8 s at most
      and never fails for want of a fix. × leaves the location off one
      memory, and an edit can only remove a location.
    - Cards show "Near <trip place>" (within 250 m, offline) or "Location
      attached", linking to the maps app.
    - The map has memory pins with a Memories toggle, and the blue dot with
      its accuracy circle and "Show where I am".
    - `shared/services/geolocation.js` is the only file that touches
      `navigator.geolocation`.
    - Fixed: invisible pressed map toggles (`bg-card`), and the journal e2e
      test's cleanup (leftover test memories removed from both dev
      databases).
  - **Phase 32 ✅ (the photo store):**
    - A `photos` table (migration 0004) and `LocalPhotoStore` under
      `PHOTO_DIR` (`<trip>/<photo>/{original.<ext>, display.jpg,
      thumb.jpg}`), behind a `PhotoStore` protocol so object storage can
      replace it later.
    - `app/photos.py` (Pillow plus pillow-heif) makes the 2560 px and 480 px
      JPEGs: upright, EXIF-free, keeping the colour profile.
    - `POST/DELETE /trips/{id}/memories/{mid}/photos` for the author only;
      at most 10 per memory, 25 MB each; an optional `id` makes retries
      safe.
    - `GET /photos/{id}/{thumb|display|original}` needs no login (an
      unguessable UUID) and is cached immutably. Memories list their
      photos.
    - nginx `client_max_body_size 26m` on `/api/`.
    - **Before deploying photos:** `fly volumes extend` to about 10 GB.
  - **Phase 33 ✅ (photos in the journal):**
    - "Add photos" in the memory dialog: the phone's own picker (camera,
      library, files), previews, removal, at most 10 and 25 MB each.
    - A thumbnail strip on cards. A full-screen viewer: the display copy,
      swipe or arrows, "Full quality" (the original, pinch-zoomable) and
      Download.
    - Photos go through the outbox (uploads with the phone's own id, after
      their memory). The service worker caches thumbnails and viewed
      display copies.
    - Fixed: the refresh/sync race that could hide a just-synced memory,
      and an edit's reply resurrecting a removed photo.
  - **Run stage 4 is done.** Before deploying it:
    - merge into the deployed line (the migrations take an existing
      database from 0001 onward);
    - `fly volumes extend` to about 10 GB;
    - test the camera on a real phone.
- **Run stage 3 (2026-10-03, on `rebuild`): sharing and the trip journal.**
  These notes were missed at the time and added on `journal-memories`.
  - **Phase 25:**
    - A `trip_members` table.
    - `get_viewable_trip` lets in the owner or a member, and gives 404 to
      anyone else. `get_owned_trip` stays owner-only: a member gets 403, a
      stranger 404.
    - `POST /trips/join {tripId}` and member list, remove and leave
      endpoints. `role` on the trip list and `TripRead`.
    - The seed adds `pripri@example.com` / `changeme-viewer`, joined to the
      sample trip.
  - **Phase 26:**
    - Join trip (paste the id), "Shared with you" and Leave trip on the
      trips list.
    - The owner's Share trip dialog: the id with copy, and the viewers with
      Remove.
    - Viewers get no edit controls at all (`selectIsViewer`).
  - **Phase 27:**
    - A `memories` table, a server UTC `created_at` as the ordering key,
      and the author's `zone`.
    - `GET`/`POST /trips/{id}/memories` for anyone on the trip;
      `PUT`/`DELETE` for the author only (403 for others on the trip).
  - **Phase 28:**
    - A Journal tab and New memory on Today.
    - `journalDays` groups memories by local date in their own zone.
    - Your own memories have Edit and Delete.
    - `journalSlice` is stale-while-revalidate with an offline copy;
      writing is off offline.
  - Also on `rebuild`: hero images in the stays/travel quick look (a stay's
    photo, or a leg's destination), and the dropped "Saved with the time
    right now" hint.
- **Run stage 2 (2026-10-03):** "find it fast" (`implementation_plan.md`,
  Phases 20–24), built one commit per phase.
  **All five are done**, waiting on Julian's look at 375px. **Next
  follow-up:** a text-size preference that also scales the timeline rails
  and dots.
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
  - **Phase 24 ✅:** the day page shows "Day N of M", has prev/next at the
    top and bottom, and swipes left/right between days (horizontal only,
    60px minimum, ignoring dialogs). Its "← Trip" link is gone. The
    timeline's House/Plane icons became a **Plan | Stays | Travel**
    segmented control. The before/after is in
    `ui/e2e/screenshots/compare-segmented-control.png`, and Julian may
    revert it.
  - **Experiment ✅ (after Phase 24):** a hero fade in the stays/travel
    quick look. The stay's photo is behind the dialog's title, through
    `Dialog`'s optional `heroImage` prop, falling back to the plain dialog
    when there's no photo or it fails to load. No thumbnail is repeated
    below. Legs stay plain. See `ui_review.md` → Experiments.
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
- **Branches:** `rebuild` (pushed to `origin/rebuild`; Run stages 1–3,
  being deployed to Fly), and `journal-memories` (stacked on it; Run stage
  4; local only). Neither is merged to `main`.
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
5. **Run stage 4, on `journal-memories`** (in progress; see Status).
   Offline memories, location and the blue dot, and photos (originals kept,
   unguessable URLs, a ~10 GB Fly volume). **Before deploying photos:**
   `fly volumes extend` to about 10 GB.
6. **Julian (deploy):** set `SEED_*` secrets on Fly before the next
   `make seed-remote`. Since 2026-10-04 the container no longer seeds on boot
   (it replanted the demo trips, deleting their memories and photos, on every
   wake from auto-stop). Seeding is only `make seed-remote`. The accounts
   already on Fly were made with the default passwords, so change those too.
7. **Julian:** try Run stage 3 at 375px. Sign in as `pripri@example.com` /
   `changeme-viewer` for the viewer's side (`make seed` created it, already
   joined to the sample trip).
8. **Julian:** look at Run stage 2 (Phases 20–24) at 375px. Keep or revert
   the Plan | Stays | Travel control.
   Then the text-size preference (the next follow-up), and later showing
   the Today tab only while a trip is active.
9. **Then, from the backlog:** editing the trip header; verification/gaps
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
make verify     # should be green: 133 API + 217 UI tests
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
- **Alembic from Phase 29a on** (Julian, 2026-10-03: the app is deployed
  after `rebuild`). Every schema change gets a migration
  (`alembic revision --autogenerate`, then review it). `make migrate`
  applies them, and start.sh and dev.sh run it. 0001 is the schema as
  deployed from `rebuild`. A pre-Alembic database is stamped there, not
  rebuilt.
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
