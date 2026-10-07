# Walk stage 2 — editing stays & travel, location-based timezones, vertical timeline ✅ (live Google Places check pending a key)

Asked 2026-10-02:
- **Travel:** must have a type (fly, boat, train, …) and a departure date and
  location. The user sees a warning when the arrival is unset. Departure and
  arrival are each in their own timezone.
- **Stays:** check-in and check-out are required.
- **Both:** confirmation number and the other booking details.
- **Timeline:** should flow like react-chrono's vertical mode: each point a
  date, its card that day's details.

**Decisions** (answered 2026-10-02 over three rounds; all recommendations
accepted except where noted):
- Our own vertical timeline in react-chrono's style. **No React upgrade**:
  chrono 3.x needs React 19, and although a trial needed no code changes, we're
  staying on the template's React 18.
- **No timezone pickers.** Every time's zone is inferred from its place; users
  only ever enter wall-clock times.
- **Google Places, in the browser.** Google's browser library is loaded only
  when a place field opens, with the key from `GET /config`.
  - The key is protected Google's way: restricted to our websites and to the
    Maps JavaScript and Places APIs, with a budget alert and a daily quota cap.
  - We considered a server-side proxy and rejected it: it added endpoints and
    a provider layer for little gain (Julian's call).
- Day cards open by default; a sticky date jumper; `boat` added as a travel
  type; the title prefilled "From → To"; the arrival warning is non-blocking;
  stay times prefilled 15:00/11:00; `roomType` (stays) and `seat` (travel)
  added; no overlap warnings yet.
- Order: API, then timeline, then forms.
- Stay and travel places must be picked from search in the UI. Imports stay
  lenient about coordinates. An activity without a place uses that night's
  stay's clock. The activity form switches to the same place search. Arrival
  time is enabled only once a "to" place is picked. Search is biased towards
  the trip's area. Only the typed place text goes to Google.

### The timezone rule

One module, `app/zones.py`, is used both by validation (import and every edit)
and by the read model. The zone for a time comes from:
1. its place's coordinates, via `tzfpy` (offline, Rust, 21 MB; tested on our
   sample places);
2. otherwise an explicit timezone in the document (an import-only escape
   hatch; the UI never shows it);
3. for an activity only, otherwise the zone of the stay that covers that night
   (or the stay checking out that morning);
4. otherwise the trip's timezone.

Which place sets which clock: a stay's place sets its check-in and check-out; a
travel leg's `from` sets departure and its `to` sets arrival; an activity's
place sets its time, and failing that, the night's stay.

**Computed when read, never stored** (lessons §2). An activity's fallback
depends on another row, the stay, so a stored zone would go stale when the
stay changes. `GET /trips/{id}` adds read-only `zone` fields (`stays[].zone`,
`travels[].departZone`/`arriveZone`, `days[].items[].zone`), computed by the
same function the rules use. Lookups take microseconds. The stored document
keeps only what the author wrote, so an import still round-trips exactly.

### API

- `GET /config` (authenticated) → `{ googleMapsApiKey }`, from
  `GOOGLE_MAPS_API_KEY` in `api/.env`; null when unset.
- `GET /timezone?lat=&lng=` (authenticated) → `{ timezone }`. This lets a form
  show "Times here are Zurich time" before saving, using the same lookup the
  server uses.
- `POST /trips/{id}/stays`, `PUT|DELETE /trips/{id}/stays/{stay_id}`
- `POST /trips/{id}/travels`, `PUT|DELETE /trips/{id}/travels/{travel_id}`
- Bookings are full replace, validated by the import rules (4 and 5, factored
  into `check_stay` / `check_travel` and using the resolved zones). Every write
  returns the whole trip. Ownership is checked through the trip (404).
- **Schema changes:**
  - Travel `from` is required.
  - New fields: `seat` (travel), `roomType` (stays), `placeId` (any location).
  - Travel types gain `boat`.
  - The timezone fields are documented as "used only when the place has no
    coordinates".

### UI

- **Vertical timeline:**
  - A rail down the left; each date is a point (weekday, date, "Day N") with
    its day card beside it.
  - Cards are open by default and collapsible. An empty date is a slim point
    with "No plans" and an Add action.
  - A sticky compact **date jumper** scrolls to a day and highlights the one
    in view. `?day=` scrolls there on load.
- **`PlaceField`** (shared):
  - You type, get Google suggestions (biased towards the trip's stays), and
    pick one, which gives the name, address, coordinates and `placeId`.
  - The name stays editable after picking, and a read-only line says "Times
    here are Zurich time".
  - If Places is unavailable (no key, or it failed to load), you can type a
    name by hand, with a note that times will use the trip's clock.
- **Travel form:**
  - Type, title (prefilled "From → To" until edited), carrier, number, seat.
  - From place (required), then departure date and time (required).
  - To place, then arrival date and time. Arrival is enabled once a "to"
    place is picked.
  - Confirmation number and notes.
  - A non-blocking warning while the arrival is incomplete.
  - Spells out cross-zone legs: "Departs 5:40 PM Chicago time · lands
    9:25 AM Zurich time".
- **Stay form:** name, type, place (required), check-in and check-out dates and
  times (required, prefilled 15:00/11:00), room type, confirmation number,
  notes.
- **Activity form:** its place fields become `PlaceField` (optional), plus a
  link field.
- Stay and travel markers get Edit and Delete (they edit the booking). The
  day card's Add button offers Activity / Travel / Stay.
- A depart marker shows a warning badge while its arrival is incomplete.

### Phases

- **Phase 7 — Walk: zones, config, stay & travel API.** ✅
  - `tzfpy`, `app/zones.py`, `check_stay` / `check_travel` on resolved zones.
  - Zone fields in the read model.
  - `/config`, `/timezone`, and the booking endpoints.
  - The schema changes; the sample gains a seat and a room type.
  - Tests:
    - zone inference, including a cross-zone flight, a night's-stay fallback,
      and an explicit timezone only applying without coordinates;
    - import/edit parity for bookings;
    - ownership;
    - config with and without the key.
- **Phase 8 — Walk: vertical timeline.** ✅ It replaces the tabs and keeps every
  behaviour. Tests are rewritten; phone-width check.
- **Phase 9 — Walk: stay & travel forms.** ✅
  - A small Google Places browser wrapper (mocked in tests), `PlaceField`,
    `StayForm`, `TravelForm`; `ActivityForm` switched to `PlaceField`.
  - Edit and Delete on markers; the Add menu; the arrival warning.
  - Tests and a phone-width check.
  - A live Places check needs Julian's key.

### Built as planned, plus

- The Google Places browser wrapper is `ui/src/shared/services/googlePlaces.js`
  (the only file that knows Google's API; mocked in tests).
- `PlaceField` falls back to a typed name when search is unavailable, so the
  app works without a key, with times on the trip's clock.
- Map links include the Google place id when there is one.
- **Not yet verified live against Google**: there is no key yet. Search,
  pick, session tokens and bias are covered by tests with a fake; the no-key
  fallback was checked in a real browser.

### Key setup (Julian; only needed for live place search)

1. In the Google Cloud console, pick a project with billing attached and set a
   **budget alert** (for example $5).
2. Enable **Maps JavaScript API** and **Places API (New)**.
3. Create an API key, then edit it:
   - **Application restrictions → Websites:** `http://localhost:3000/*`, plus
     the production domain when there is one.
   - **API restrictions → Restrict key:** Maps JavaScript API and Places API
     (New).
4. Optional backstop: Places API (New) → Quotas → set a daily request cap.
5. Put it in `api/.env` as `GOOGLE_MAPS_API_KEY=…` (gitignored). The browser
   receives it from `GET /config`.
