# Walk stage 3 — location photos, bottom nav & map view

Asked 2026-10-02:
- Store the first Google Places photo with a picked location.
- A bottom nav (Timeline / Map tabs) while viewing a trip.
- A full-screen map: every trip location as a marker (icon by kind — house
  for stays, travel's mode icon, a plain pin otherwise), Advanced Markers
  specifically. Tapping one opens an info window: photo, title, day of trip,
  a link to that day, and a directions link out to the phone's own maps app.
  Search by name; a House button jumps to stays; a Calendar button filters to
  one day (other dates disabled).

**Decisions** (answered 2026-10-02):
- **Photo storage:** store the resolved image URL (`Photo.getURI()`) as
  `LocationDoc.imgRef` at pick time, not a reference re-resolved on every
  view. Simpler, no extra Places calls to display it. Caveat, not fully
  confirmed: if Google ever rotates these URLs, an old trip's photo could go
  stale until the place is re-picked — accepted for now.
- **Map search:** searches the trip's own locations (stay names, activity
  titles, cities) and highlights/filters matching markers. Falls back to a
  general Places text search only to re-center the map on a place for
  orientation (e.g. typing "Interlaken" pans there even with nothing booked
  yet) — it never adds anything to the trip from the map.
- **Map filters:** the House (stays) and Calendar (one day) filters combine,
  not mutually exclusive — both active shows stays happening on that day.
  Real filter-intersection logic, not a 3-way switch like the timeline's
  stays/travel toggle.
- **Map ID:** required for Advanced Markers; Julian needs to create one (see
  Key setup below) and put it in `api/.env` alongside the Maps key, served by
  `GET /config` as `googleMapsMapId`.

### Phase 13 — Walk: location photos & mini-map previews ✅

- `LocationDoc.imgRef` (`img_ref`, alias `imgRef`): an optional URL, no
  pattern beyond the existing `url` field's.
- `googlePlaces.js`'s `pick()` requests the `photos` field and stores
  `photos[0].getURI({ maxWidth: 800 })` as `imgRef` when present.
- `MiniMap` (`shared/components/MiniMap.jsx`): a small, non-interactive
  `google.maps.Map` centered on one point with a classic `Marker` (no Map ID
  needed for this — only the full map page's Advanced Markers need one).
  Shown in `PlaceField` once a place is picked. In `LocationBlock` (day page
  entries, the details dialog) it's the fallback only — a static map wasn't
  pulling its weight next to a real photo of the place, so `LocationBlock`
  shows `loc.imgRef` when there is one, the mini-map otherwise (changed
  2026-10-02).
- `googleMapsLoader.js` factors the Maps JS bootstrap script out of
  `googlePlaces.js`, so `places`, `maps` and `marker` all share one script
  tag instead of each library loading its own.
- Fixed in passing: `"boat"` was a valid `TravelMode` missing from
  `describeEntry.js`'s icon/label maps, silently falling back to a generic
  icon — now mapped to `Ship`/"Boat" like `ferry`.

**Tests**: `make verify` green; a live Playwright pass showing the mini-map
rendering real tiles in `PlaceField`, and (after the photo-vs-map change
below) a real photo rendering in the details dialog for a location that has
one.

**Backfill for locations that predate this feature** (added 2026-10-02):
`python -m app.backfill_photos` (`make backfill-photos`) finds every stay,
travel endpoint and activity without a photo yet and fills it in —
idempotent, best-effort, safe to re-run. Two cases:
- Already has a `placeId` (picked from search in the UI) — look up its
  photo directly.
- No `placeId` (typed by hand, or imported — e.g. with coordinates from a
  free geocoder rather than Google, as `example-trip.json`'s Okinawa trip
  was) — resolve it first via a Places **text search** on name +
  address/city, then fetch that place's photo. This is the half Julian
  actually needed: almost nothing in real trip data has a `placeId`, since
  that's only ever set by the live Places picker or a real import; the
  placeId-only version of this script found almost nothing to do.
  A generic/ambiguous name can match the wrong place — nothing
  double-checks it, so the printed log is there to spot-check.

`app/google_places_server.py` is the one deliberate exception to "this app
never calls Google from the server": verified empirically that the browser
key's "HTTP referrer" restriction only rejects a request whose Referer
doesn't match the allowlist, not a plain server-side request with no
Referer header at all — so no second key or header spoofing was needed.
**Not** wired into `POST /trips/import` (asked and decided 2026-10-02) — an
import shouldn't gain a live dependency on Google being reachable; run the
script by hand after importing if you want photos. `httpx` moved from
dev-only to a real runtime dependency, since this script is app code, not a
test.

Live-verified end to end against the real dev database, twice: (1) gave a
real stay (Hotel Palm Royal, the Okinawa trip) a genuine Google place id,
ran the script, got back a real photo of the hotel's pool; re-running
confirmed it skips already-backfilled rows. (2) After the text-search
extension, ran it against the freshly reseeded sample trip (all 14 of its
locations lacked a `placeId`) — all 14 resolved and got a photo, including
spot-checking the riskiest, most generic names ("Bern", "Zürich Flughafen")
against the actual returned photos, which were correct.

### Phase 14 — Walk: bottom nav & the map view ✅

- `BottomNav` + `BottomNavLayout` (`shared/components/`): Timeline (a list
  icon) / Map (a map-pin icon) tabs, visible only on `TripTimelinePage`,
  `DayDetailPage` and the new map page — a full-height flex shell with the
  nav pinned below scrollable content, not a fixed overlay (no
  scroll-padding guesswork to keep content from hiding behind it).
- `GET /config` gained `googleMapsMapId` (`GOOGLE_MAPS_MAP_ID` in `.env`,
  alongside the Maps key).
- `buildMapMarkers.js` (`features/map/`): one marker per located stay, per
  travel leg's `from` and `to`, and per activity with a place — pure, no
  Google Maps involved, so it's tested independently of the widget.
- `MapPage`: `AdvancedMarkerElement` (the `marker` library) for every
  marker, a `PinElement` colored by kind with an **emoji glyph** standing in
  for a per-kind icon (🏨 stay, the travel mode's emoji, 📍 activity) — a
  deliberate simplification instead of hand-building SVGs for a non-React
  marker; swappable for real icons later. Tapping a marker opens an
  `InfoWindow`: the location's photo (`imgRef`, if any), title, day heading,
  a link to that day's page, and a directions link
  (`https://www.google.com/maps/dir/?api=1&destination=lat,lng`, opens the
  phone's own maps app). Missing key, missing Map ID, and zero located
  places each show their own message instead of a blank or broken map.
- The initial view fits stays/activities only, not travel's endpoints —
  otherwise an international flight's departure airport (a continent away)
  drags the default zoom out to show the whole ocean instead of the trip
  itself. Found via the live check below, not guessed up front.

**Tests**: `buildMapMarkers.test.js` (stays/located legs/activities
included, unlocated legs and place-less activities skipped, same-date
correctness) — `make verify` green, 101 API + 86 UI. Julian created the Map
ID; a live Playwright pass against it confirms the bottom nav, its
active-tab state, all 10 of the sample trip's located markers present, the
map correctly fitted to Bern/Wengen (not the Atlantic), and clicking a
marker opens an info window with a working "View day" and "Directions"
link. Along the way, fixed two Advanced Marker API deprecations
(`PinElement`'s `glyph` → `glyphText`; `content: pin.element` → `content:
pin`) — but kept `marker.addListener("click", ...)` over the newer
`addEventListener("gmp-click", ...)` after the library's own runtime
message said the older form is what gives the built-in keyboard/accessible
click handling.

**Fixed 2026-10-03**: the info window's title/day text had no explicit
color, so it inherited this app's dark-theme `color` (near-white) cascading
down from `<body>` — Google's InfoWindow content is appended outside the
React tree but still sits in the same document, so that inheritance still
applies. Invisible on the InfoWindow's own always-white chrome. Gave every
text node in `infoWindowHtml` an explicit color instead of trying to
restyle Google's chrome itself (fighting undocumented `.gm-style-iw-*`
class names for a true "dark mode" InfoWindow — not worth it for a popup
that opens over a full-color map anyway, white chrome reads fine once the
text itself is legible).

### Phase 15 — Walk: map search & filters ✅

- `markerSearch.js`: `matchMarkers(markers, query)` — a marker matches by
  title or city, case-insensitive, no network call.
- `mapFilters.js`: `markerMatchesDate(marker, date)` — a stay matches any
  night it covers (via a new `endDay` on stay markers, exclusive, like
  `stayCoverage`'s rule); everything else matches only its own `day`.
  `filterMarkers(markers, { stayOnly, date })` combines House (stays only)
  and Calendar (one day) — both together means "stays happening on that
  day", per the Walk stage 3 decision.
- `MapControls` (in `MapPage.jsx`): a search box styled like `PlaceField`'s
  suggestion list (reusing that pattern, not the component — this isn't
  picking a place to save). Typing matches the *currently filtered* marker
  set first; submitting with no local match falls back to
  `Place.searchByText` (client-side Places JS, one-shot — no autocomplete
  session needed for a single lookup) to pan the map, adding nothing to the
  trip. Picking a suggestion pans + opens its info window. The Calendar
  filter is a plain `<input type="date" min max>` (min/max = trip range, so
  the browser's own picker greys out everything else) toggled via a button,
  becoming a "Tue, May 12 ×" chip once set, per the decisions made asking
  this out.
- Markers are shown/hidden by filters, not re-fit or re-centered — the
  bounds set on initial load stay put.

**A real bug, found by testing, not by inspection**: markers were
originally left in place and toggled via `element.map = null`/`map`. Live
Playwright testing of a full filter round-trip (all → stays only → all
again) found the marker count permanently dropped from 10 to 8 after one
cycle — not a timing issue (reproduced consistently, confirmed with longer
waits). Tracing it by marker position pinned it down: of two markers
sharing the *exact same coordinates* (Chicago O'Hare, appearing on both the
outbound and return flight — routine for any round trip), detaching and
reattaching silently dropped one of them for good. Fixed by rebuilding the
marker elements from scratch on every filter change instead of toggling
`.map` on existing ones; the map instance, its bounds and the InfoWindow are
untouched, so this doesn't re-fit or jump the view. Verified with 3 full
toggle cycles live — stable at 10 every time.

**Tests**: `mapFilters.test.js`, `markerSearch.test.js` (pure, no Google
Maps involved) — `make verify` green, 115 API + 97 UI. A live Playwright
pass: search suggestion → pan → info window; House filter → exactly the
trip's 2 stays; round-tripping it off → still all 10 (the regression test
for the bug above); House + Calendar combined → exactly the 1 stay covering
that day.

### Key setup (Julian; only needed for the map view)

1. In the Google Cloud console, **Google Maps Platform → Map Management →
   Create Map ID**.
2. Map type: **JavaScript**. Vector rendering (the default) is fine — no
   custom style is needed yet.
3. Put the generated Map ID in `api/.env` as `GOOGLE_MAPS_MAP_ID=…`
   (gitignored), alongside the existing `GOOGLE_MAPS_API_KEY`.
4. No new API needs enabling — Advanced Markers live under the Maps
   JavaScript API, already enabled.
