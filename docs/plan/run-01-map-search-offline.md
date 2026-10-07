# Run stage 1 — map place search & add-from-map; installable offline app

Asked 2026-10-03:
- **Map search, part 2.** When the trip has no match, show Google Places
  autocomplete results too, each clearly marked as *not saved* (new, from
  Google). Picking one zooms to a marker with an info window: the place's
  photo, then Add activity / Add travel / Add stay, offering only the ones
  that make sense for that place. A link opens the matching form with the
  place already filled in.
- **Offline, back from v1.** The app can be installed on the phone as a PWA.
  The phone caches the trips: with no network it shows the cached copy, and
  with a network it refreshes from the server.
- **A logo:** a heart behind the outline of an airplane. Draft:
  [`docs/brand/logo.svg`](docs/brand/logo.svg).

**Decisions** (answered 2026-10-03; folded into the design below):
- **Order:** offline first (Phases 18–19), then map search (16–17). Julian
  asked for it in **two commits**, one per pair, rather than four separate
  phase gates.
- **Add travel** offers two links, "Travel from here" and "Travel to here".
- Actions: the relevant ones first, then "More…" for the rest. A city or
  region offers no Add action.
- **The default date for a form** is worked out by a new shared module,
  `shared/utils/tripDates.js` (where "today" is, whether a date is inside the
  trip, a trip's phase, the default form date). It's reusable, so later "what's
  next" and today-aware screens use the same lookups instead of each doing
  their own.
- **HTTPS:** a Fly.io deploy (the pattern is already in the repo). Until
  then, everything is built and verified on `localhost`, which counts as
  secure for service workers.
- Every trip that hasn't ended is cached in the background. The app is
  **read-only** while offline. A login lasts **60 days**. Updates come with
  an "Update available · Reload" toast.
- **Logo:** the heart fills most of the icon, and the plane is larger and
  points straight up (Julian's feedback).

### Design: map place search (Phases 16–17)

- **One suggestion list, two sections.**
  - **On this trip:** matches from `matchMarkers` against the currently
    filtered markers, as today. Each row shows its kind icon (stay, travel
    mode, activity).
  - **New places:** live autocomplete from `googlePlaces.js`'s existing
    `createPlacesSearch()`. Only the typed text goes to Google. It runs at 3+
    characters with a 250 ms debounce, like `PlaceField`, and is biased to the
    map's current viewport (`map.getBounds()`), not the trip's stays. Each row
    gets a `New` badge, a different icon (a plus-pin) and its secondary text
    (the area). That makes "not saved yet" visible without reading.
  - Google rows always appear below the trip rows, never mixed in. A Google
    row is dropped when its `placeId` matches a trip location's `placeId`, so
    a saved place doesn't show twice.
  - **Enter** picks the first row of the list. Today's one-shot
    `Place.searchByText` pan fallback is removed, because autocomplete
    replaces it.
  - When offline, or when Places is unavailable, the Google section is
    hidden and only trip rows show (see Phase 19).
- **Picking a Google row.**
  - `pick()` gains `types` and `primaryType` in its `fetchFields` list.
    Everything it already returns stays the same (name, address, city,
    coordinates, `placeId`, `imgRef`).
  - A single **search-result marker** is dropped on the map. It looks
    different from trip markers: a white pin with a dark border and a `+`
    glyph. Picking another result replaces it, and clearing the search
    removes it. It is never stored.
  - The map pans there, zooms to 15 and opens the info window.
- **Info windows are rendered by React.** Today's `infoWindowHtml` string is
  replaced by a container `div` passed to `InfoWindow.setContent(div)`, with
  the content rendered into it through `createPortal`. Buttons get real
  React handlers (no `onclick` strings and no global functions), and colors
  can come from tokens.
  - The existing trip-marker info window moves to the same component and
    looks the same as today.
  - The text-color fix from 2026-10-03 still applies (the window's chrome
    is white).
- **The search-result info window** shows:
  - the photo (`imgRef`), or nothing when there isn't one;
  - the name, the address, and a small "Not in this trip" label;
  - the relevant **Add** actions (below), then Directions.
- **Which actions are relevant.** `placeActions(types)` is a pure, tested
  function that maps Google's place types to the actions to offer:

  | The place is | Offered |
  |---|---|
  | lodging (`lodging`, `hotel`, `motel`, `hostel`, `resort_hotel`, `inn`, `bed_and_breakfast`, `guest_house`, `campground`, …) | **Add stay**, Add activity |
  | a transport hub (`airport`, `international_airport`, `train_station`, `bus_station`, `transit_station`, `subway_station`, `light_rail_station`, `ferry_terminal`) | **Add travel**, Add activity |
  | a city or region (`locality`, `administrative_area_level_*`, `country`, …) | none: the map just pans there for orientation, as today |
  | anything else (restaurants, sights, shops, parks, …) | **Add activity** |

  The primary action is listed first. A "More…" link reveals the other
  actions, in case Google's types are wrong (Q-R3).
- **Pre-filled forms from the map.**
  - `StayForm`, `TravelForm` and `ActivityForm` gain an optional
    `prefill` prop. `toStayValues`, `toTravelValues` and `toFormValues` take
    it, so the picked place lands in the place field. The form's existing
    rules then apply as usual: a new stay is named after its place, a
    travel title follows its places, and the zone line shows the place's
    clock.
  - Travel offers **"Travel from here"** (the place goes in From) and
    **"Travel to here"** (it goes in To).
  - **Which date** the form starts on. `defaultFormDate(trip, { kind,
    preferred, now })` in `shared/utils/tripDates.js` decides it:
    1. the map's Calendar filter, when it's set;
    2. otherwise today, when today is inside the trip. "Today" is
       `todayIn(trip.timezone)`, the trip's own calendar day, not the
       phone's;
    3. otherwise, for a stay, the first night with no stay (`stayCoverage`);
    4. otherwise the trip's first day.
  - `MapPage` mounts the forms and saves through the same thunks and
    `runEdit` the timeline pages use. After a save, the trip reloads into
    state, the markers rebuild, and the new place is now a normal trip
    marker. The search-result marker is removed and a toast is shown
    (design_doc).
  - The map keeps its view. Saving doesn't re-fit the bounds.

### Phase 16 — Run: Places results in map search ✅

- Places suggestions in `MapControls`, in two sections with the `New` badge
  and de-duplicated by `placeId`. The suggestions are biased to the viewport.
- `pick()` returns `types` too.
- The search-result marker, and the React-portal info window. The trip-marker
  info window moves onto it too. Directions are included, but no Add actions
  yet.
- The search placeholder changes to "Search trip or places".

**Tests**
- Pure tests:
  - de-duplication (a Google row whose `placeId` is already in the trip is
    dropped);
  - section order (trip rows always first).
- `MapControls` component test, with a mocked `googlePlaces.js`:
  - the `New` badge and the section headings render;
  - Enter picks the first row;
  - the Google section is absent when Places is unavailable.
- `make verify` green.
- A live Playwright pass:
  - type a café near Bern: trip rows first, then `New` rows;
  - pick one: zoom, the search-result marker, and the info window with its
    photo;
  - the trip markers' info windows still work, with the same 10 markers as
    before.
- Julian checks it at 375px.

### Phase 17 — Run: add to the trip from the map ✅

- `placeActions(types)`, the action links in the search-result info window,
  and "More…".
- A `prefill` on all three forms, the date rule, and the forms mounted on
  `MapPage`.
- After a save, the place becomes a trip marker and the search-result marker
  is removed.

**Tests**
- `placeActions`: lodging, transit hubs (airport and train station), a city,
  a restaurant, an empty or unknown `types`.
- `defaultFormDate` (in `tripDates.test.js`): Calendar filter set; today inside the trip; today outside
  the trip; the first uncovered night for a stay.
- Form tests: `prefill` puts the place in the right field for each form, a
  stay's name defaults from the place, and a travel title follows it.
- A map page test, with mocked Places and thunks: pick, then Add activity,
  then the form opens pre-filled, then save, then the trip is updated and a
  toast shows.
- `make verify` green.
- A live Playwright pass at 375px: add a real restaurant as an activity and a
  real hotel as a stay from the map, and check that both appear on the day
  pages and as trip markers.
- Julian checks it at 375px.

### Phases 16–17: built as planned, plus

- **Files:** the map page is split into `MapControls.jsx` (the search box
  and filters), `MapInfoContent.jsx` (the info window, rendered by React),
  `mapStyle.js` (pin glyphs, colors and icons) and the pure `searchRows.js`
  and `placeActions.js`. `MapPage.jsx` wires them together.
- **"View day"** in a trip marker's window is now an in-app `Link`. The old
  HTML string's plain `href` reloaded the whole page.
- **A new activity's title** defaults to the place's name, as a new stay's
  name already did. It's editable.
- **The map shows even with no located places**, instead of the old "No
  located places" message, so a trip's first places can be found and added
  from the map.
- **The info window no longer opens under the search bar.** A focused marker
  sits 140 px below center (`FOCUS_OFFSET_PX`). Found in the live
  screenshots; this is `ui_review.md` §6's info-window item.
- **Google's `types`** come back on the picked place, and are dropped
  before anything is stored, because the API rejects unknown location
  fields. `PlaceField` drops them too, and a test checks the saved payload.
- **Viewport bias is a bias, not a filter.** "Café Fédéral Bern" can still
  surface a Café Fédéral elsewhere if Google ranks it higher. That's
  expected; the address line shows which one it is.
- **Tests:**
  - `placeActions`, `searchRows`, `defaultFormDate` and form prefill unit
    tests;
  - `MapSearch.test.jsx`, the whole flow against a fake Google Maps: the
    sections and de-duplication, viewport bias, the search-result marker,
    actions and More…, the prefilled form saving to the API without
    `types`, a city only panning, Enter, and no Google;
  - `MapInfoContent.test.jsx`.
- `make verify` green: 115 API + 159 UI.
- **Live** (`e2e/trip.spec.js`, real Google APIs, run serially), at 375px:
  - search "Café Fédéral Bern", then pick it: a + marker and an info window
    with its photo, clear of the search bar;
  - Add activity, then Save: it's a trip marker now;
  - "Hotel Bellevue Palace Bern", then Add stay first, then Save;
  - the test deletes both afterwards, so the dev trip is unchanged.
- Julian still needs to check it at 375px himself.

### Design: installable offline app (Phases 18–19)

**HTTPS.** A service worker, and therefore install and offline, only works in
a *secure context*. `localhost` counts, but the LAN address the phone uses
today (`http://<pi-ip>:3000`) does **not**. For now everything is built and
verified on `localhost`. Installing it on the phone waits for the Fly.io
deploy, which already has its pattern in the repo (`fly.toml`, `make image`),
and gives HTTPS automatically.

- **`vite-plugin-pwa`**, as in v1, with `generateSW` (Workbox).
  - **Precache** the app shell: JS, CSS, `index.html`, icons and fonts.
  - Use `navigateFallback: index.html`, with a denylist covering the API
    path, so deep links like `/trips/:id/days/:date` open offline.
  - **The service worker never caches API responses.** Trip data lives in
    IndexedDB, managed by the app, as in v1. That keeps it per-user and
    clearable on sign-out, and lets the UI say how old the copy is.
  - The service worker is off in `vite dev`. It's tested with `vite build &&
    vite preview` (localhost) and with `make image`.
  - `/runtime-config.js` is injected when the container starts, so it's
    left out of the precache. It's served network-first and falls back to
    the last copy offline.
- **Manifest:**
  - `name` "PriPriTrip", `short_name` "PriPriTrip";
  - `display: standalone`, `start_url: "/"`, `scope: "/"`;
  - `theme_color` and `background_color` set to the dark background
    (`#12151c`), so the splash and status bar aren't a white flash;
  - icons at 192, 512, a 512 maskable, and a 180 `apple-touch-icon`;
    `favicon.svg` replaces the default.
- **Icons are generated by a script, not exported by hand.** `make icons`
  runs `scripts/make_icons.mjs`, which rasterizes `docs/brand/logo.svg` with
  the preinstalled Chromium (Playwright). The maskable variant pads the logo
  to the 80% safe zone. The PNGs are committed.
- **iOS and phone chrome:**
  - `apple-mobile-web-app-capable`, a status-bar style of
    `black-translucent`, and `viewport-fit=cover`;
  - `BottomNav` gets `padding-bottom: env(safe-area-inset-bottom)`, so the
    home indicator doesn't sit on the tabs;
  - pages get top padding for the notch.
- **Updates.** Use `registerType: "prompt"`. When a new version is ready, a
  toast says "Update available · Reload", and nothing reloads by itself in the
  middle of a form.
- **Install button.** On Android/Chrome, the trips page shows an "Install
  app" button off `beforeinstallprompt`. On iOS, which has no prompt, a
  one-time hint: "Share → Add to Home Screen". It's hidden when the app is
  already running standalone.
- **nginx** (`deploy/nginx.conf`):
  - `sw.js`, `registerSW.js`, `manifest.webmanifest` and `index.html` are
    served `Cache-Control: no-cache`, so an update is never stuck behind a
    cached service worker;
  - hashed assets are served `immutable`.

**The trip cache (Phase 19)**
- **`shared/services/tripCache.js`** uses `idb-keyval` (about 1 KB; v1's
  hand-rolled IndexedDB code is the fallback if we'd rather add no
  dependency).
  - Keys are `trips:<userId>` (the list) and `trip:<userId>:<tripId>` (each
    full `TripRead`, plus `savedAt`).
  - The user id is part of the key, so a second account on the same phone
    never sees the first account's trips.
- **Stale-while-revalidate** in `fetchTrips` and `fetchTrip`:
  0. The user id comes from the stored token's `sub` claim, not from
     `GET /users/me`, so the cache can be found while offline.
  1. Read the cache. If there's a copy, render it **immediately**. That makes
     it faster online too, which suits "find it fast".
  2. Then request from the network.
     - On success, replace state and the cache.
     - On a *network* error (no response), keep the cached copy and mark the
       slice `stale: true` with `savedAt`.
     - A real 404 still means "not found", and the cached copy is removed.
- **Every write** (every edit already returns the whole trip) also writes
  the cache, so the copy is never older than the last edit made on this
  phone.
- **Which trips are cached.** Whenever the trips list loads online,
  each trip that hasn't ended yet is fetched and cached in the background
  (a few small requests, each under 1 MB). Past trips are cached only when
  opened. "Download a trip for offline" doesn't need to be a separate step.
- **No error toasts for an expected offline failure.** Requests that the
  cache backs (the trips list, a trip, `/users/me`, `/config`) are marked
  `offlineOk`. A network error on them (no response) shows the offline bar
  instead of an error toast.
- **Offline indicator.**
  - `useOnlineStatus()` (as in v1) plus the slice's `stale` flag.
  - A slim bar under the page header: "Offline · saved copy from 2:14 PM".
    It goes away once a refresh succeeds.
- **Editing offline is turned off, not queued.** Add, Edit, Delete
  and Move buttons are disabled with the hint "You're offline". There's no
  write queue, so there are no conflicts to resolve and edits can't be lost.
- **Sign-in offline.**
  - `ProtectedRoute` only checks that a token exists, so a phone that's
    already signed in opens offline. A network error never signs anyone out:
    only a real 401 does, and only once back online.
  - **Sign out** clears that user's cache. A token that has simply *expired*
    keeps the cache, which is still keyed by the user, so signing back in
    shows trips at once.
  - **The JWT lasts 60 days** (`jwt_expiry_hours`, raised from 7), so a long
    trip doesn't hit the login screen partway through.
- **The map and photos offline.**
  - Google Maps can't render offline. The map tab shows "The map needs a
    connection", with a plain list of the trip's places and their directions
    links. Those links hand off to the Google Maps app, which has its own
    offline areas, so download the trip's region there before leaving.
  - Place photos are Google-hosted URLs. They are **not** cached (Google's
    terms limit caching Places content). Offline, a photo that fails to load
    is hidden through `onError`, not shown as a broken image.
  - `PlaceField` already falls back to a typed name when Places is
    unavailable, but editing is off while offline anyway.

### Phase 18 — Run: installable app (logo, manifest, service worker, HTTPS) ✅ (phone check pending the Fly deploy)

- `docs/brand/logo.svg`, `make icons`, the PNGs, and `favicon.svg`.
- `vite-plugin-pwa`: the manifest, the app-shell precache, the navigation
  fallback, and the update toast.
- iOS meta tags and safe-area padding; the install button and the iOS hint.
- `deploy/nginx.conf` cache headers.
- A note in `deploy/README.md`: install and offline need HTTPS, which Fly
  provides. The deploy itself isn't part of this phase.

**Tests**
- Unit:
  - the install-button logic (shown on `beforeinstallprompt`, hidden when
    standalone);
  - the update toast fires when the service worker says an update is ready.
- `make verify` green.
- **Live, built app** (`vite build && vite preview`, Playwright):
  - the manifest is valid and the icons resolve;
  - the service worker is registered;
  - with the browser set offline, reloading `/trips/:id/days/:date` still
    renders the shell (no dinosaur page).
- **Julian, on the phone once it's deployed to Fly (HTTPS):**
  - install to the home screen;
  - the icon and splash look right;
  - it launches standalone and the bottom nav clears the home indicator.

### Phase 19 — Run: offline trip cache ✅ (phone check pending the Fly deploy)

- `tripCache.js` and stale-while-revalidate in `tripsSlice` and
  `timelineSlice`.
- `shared/utils/tripDates.js` (`todayIn`, `tripPhase`), which decides which
  trips "haven't ended". Phase 17 adds `defaultFormDate` to it.
- `JWT_EXPIRY_HOURS` defaults to 60 days.
- Background caching of trips that haven't ended, and writes refresh the
  cache.
- `useOnlineStatus`, the offline bar, editing disabled offline, the offline
  map fallback, and hidden photos that fail to load.
- Sign-out clears the cache.

**Tests**
- `tripCache` with `fake-indexeddb`: reads and writes per user, cleared on
  sign-out, and another user's keys are never read.
- Slice tests:
  - a cache hit renders before the network answers;
  - the network wins when it answers;
  - a network error keeps the cached copy and sets `stale`;
  - a 404 removes the cached copy;
  - a 401 still signs the user out;
  - a write updates the cache.
- Component tests:
  - the offline bar text;
  - edit buttons are disabled offline;
  - the map shows its offline fallback list.
- `make verify` green.
- **Live, Playwright on the built app:** load trips online, set the browser
  offline, then:
  - the trips list, the timeline, a day page and the stays view all render
    from the cache, with the offline bar showing;
  - going back online clears the bar and refreshes.
- **Built as planned, plus:**
  - The offline map list uses real icons (lucide), not the pins' emoji. The
    headless browser has no emoji font, so the emoji rendered as empty
    boxes there, as `ui_review.md` §6 suspected for the map pins.
  - A failed trips load with nothing saved now says "Couldn’t load your
    trips" with Try again, instead of the misleading "No trips yet".
  - Pages refetch whenever the connection changes. Back online refreshes;
    going offline falls back to the saved copy and marks it stale.
  - `ui/e2e/offline.spec.js` is the live check (built app plus `vite
    preview`; see `ui/e2e/README.md`). It passed: manifest and icons, then
    offline reloads of the trips list, a timeline, the never-opened Okinawa
    trip, a day page and the map tab, and back online clears the bar.
    The `deploy/nginx.conf` change passed `nginx -t`.
- **Julian, on the phone (after the Fly deploy):** airplane mode, then open the app from the home
  screen and find tonight's hotel and a confirmation number.

### Open questions (Run stage 1)

Map search:

- **Q-R1. Which order?** The Okinawa trip starts **Oct 29**, 26 days from
  today. Offline only helps that trip if it's working and installed on the
  phone before then, and Q-O1 (HTTPS) may take some setup on Julian's side.
  - Recommendation: **build Phases 18–19 (PWA/offline) first**, then 16–17
    (map search).
  - **Answer:** yes, offline first (2026-10-03). Built as two commits: 18–19, then 16–17.
- **Q-R2. Where does "Add travel" put the place: From or To?**
  - (a) Always **To**: you search where you're going.
  - (b) Two links, "Travel from here" and "Travel to here".
  - (c) To, unless the trip already has a leg arriving there that day, in
    which case From.
  - Recommendation: **(b)**. It's explicit, and both are common (an airport
    is often both).
  - **Answer:** recommended, (b) two links (2026-10-03).
- **Q-R3. Strictly relevant actions, or relevant first?**
  - (a) Show only what `placeActions` decides.
  - (b) Show those first, plus a "More…" link to the rest, in case Google's
    types are wrong (a ryokan typed as a restaurant, say).
  - Recommendation: **(b)**.
  - **Answer:** recommended, (b) relevant first, then "More…" (2026-10-03).
- **Q-R4. Which date does a form open on?**
  - Recommendation: the order in the design above: the Calendar filter, then
    today if it's inside the trip, then the first night with no stay (stays
    only), then the trip's first day. The date is editable in the form
    anyway.
  - **Answer:** yes, as a reusable shared module (2026-10-03): `shared/utils/tripDates.js`. It adds about 40 lines of logic, and later today-aware features build on it.
- **Q-R5. Should a city or region result offer any Add action?** The
  recommendation is none: it just pans there, as today.
  - **Answer:** recommended, none (2026-10-03).

Offline / PWA:

- **Q-O1. How does the phone reach the app over HTTPS?** This is required
  for install and offline. Options:
  - (a) **Deploy to Fly.io.** `fly.toml` and the single-container image
    already exist. HTTPS is automatic and it works anywhere, including in
    Japan. It's a real deploy, so it needs Alembic or a reset policy, pinned
    dependencies, the Google key's referrer list updated, and the
    `CORS_ORIGINS` and Map ID settings carried over.
  - (b) **Tailscale Serve on the Pi** (`tailscale serve 443 …`). You get
    HTTPS on a `*.ts.net` name with a real certificate, the app stays
    private to your devices, and there's no public deploy. The Pi has to be
    on and reachable while traveling.
  - (c) **Caddy or mkcert on the LAN.** This only works at home, which
    defeats the point for an overseas trip.
  - Recommendation: **(b) for now**. It's the least work and fully private,
    and an installed PWA is offline-first anyway, so the Pi only needs to be
    reachable to refresh. (a) when you're ready to really deploy.
  - **Answer:** Fly.io, the pattern already in the repo (2026-10-03). Rely on `localhost` until it's deployed.
- **Q-O2. Which trips get cached in the background?**
  - (a) Every trip that hasn't ended.
  - (b) Every trip.
  - (c) Only trips you've opened.
  - Recommendation: **(a)**.
  - **Answer:** (a), every trip that hasn't ended (2026-10-03).
- **Q-O3. Editing while offline?**
  - (a) Read-only offline: edit buttons disabled.
  - (b) Queue edits and send them when back online. This needs conflict
    handling, and the server's whole-trip responses make merging
    non-trivial.
  - Recommendation: **(a)** now, and (b) only if you miss it on the trip.
  - **Answer:** (a), read-only (2026-10-03).
- **Q-O4. The 7-day login versus a 15-night trip.**
  - (a) Raise `JWT_EXPIRY_HOURS` to 30 days. One setting, no new code.
  - (b) A sliding refresh, where each successful request renews the token.
    More code.
  - (c) Leave it. An expired token offline still shows the cache; you'd sign
    in again once you're online.
  - Recommendation: **(a)**, together with (c)'s behavior, which the design
    already gives.
  - **Answer:** raise it to **60 days** (2026-10-03).
- **Q-O5. How should updates apply?**
  - (a) The "Update available · Reload" toast.
  - (b) Auto-reload as soon as an update is ready, which can wipe an open
    form.
  - Recommendation: **(a)**.
  - **Answer:** (a), the toast (2026-10-03).
- **Q-O6. The logo.** The draft is `docs/brand/logo.svg`: a rose heart
  (`#ec4f6b`) behind a white airplane outline, nose up and to the right, on
  the app's dark background. Keep it, or change the color, the plane's
  angle, or the stroke weight? At 16px only the heart reads, which is
  normal for a favicon.
  - **Answer:** the heart fills more of the icon, and the plane is larger and points straight up (2026-10-03). Done.
