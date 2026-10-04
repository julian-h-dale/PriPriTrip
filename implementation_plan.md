# Implementation Plan — PriPriTrip (rebuild)

## Summary

Rebuild PriPriTrip on `project-template`, from the trip document outward. Phase 0
reset the repo onto the template. The crawl phases then go in order:

1. Define the trip document: Pydantic models, generated JSON Schema, and DB tables.
2. Import it and read it back through the API.
3. Build the home screen (trip list and import).
4. Build the trip timeline.

After Phase 4, Julian provides a real itinerary, which we convert to a trip
document and import. Editing and verification are walk/run work, listed in the
backlog.

## Architecture Decisions

- **The trip document is the contract.** `TripDocument` (Pydantic, in
  `api/app/trip_document.py`) is the single source of truth.
  `schema/trip.schema.json` is *generated* from it (`make schema`), and a test
  fails if the committed file is stale. `GET /schema/trip` serves the same
  schema.
- **Bookings live at trip level; plans live in days.**
  - `stays[]` and `travels[]` are trip-level lists with their own rules.
  - `days[].items[]` are activities only.
  - Nothing derived is ever stored. The timeline computes its markers from
    stays and travels at render time, in one pure UI function
    (`buildTimeline`). The API stores exactly what the document says.
- **What counts as travel:** a booked or scheduled leg (flight, train, bus,
  ferry, car). Incidental movement ("walk to the old town", "taxi to the hotel")
  is an activity with notes.
- **Import always creates.** `POST /trips/import` builds a brand-new trip. The
  schema has no id fields, so a document can't carry ids. Nothing is updated,
  merged or replaced.
- **All-or-nothing, reject on any error.** Every error is returned in one 422
  response, each with a JSON path (for example `days[2].items[0].start`).
  Validation has two layers:
  1. Structural: Pydantic and the JSON Schema.
  2. Cross-field rules, which a JSON Schema can't express. These are listed in
     the schema's `description` so external authors can see them.
- **One write path.** All trip writes go through `services/trips.py`. The
  import, and later editing, call it. Routers stay thin (template convention).
- **Read shape = document shape.** `GET /trips/{id}` returns the
  `TripDocument` shape plus ids and audit fields. The UI renders from it, and a
  future "export" is the same payload.
- **Tables:** `trips`, `stays`, `travels`, `days`, `items`.
  - All have UUID PKs and the soft-delete mixin.
  - `trips.user_id` holds ownership. Children are reached only through an owned
    trip (`get_owned_trip`, 404 otherwise).
  - Days are unique per `(trip_id, date)` among live rows (a partial unique
    index).
  - `stays`, `travels` and `items` carry a `position`: the document order.
  - Locations are a JSON column (`location`, `from_location`, `to_location`),
    not a table.
- **SQLite gotcha.** Foreign keys are not enforced unless
  `PRAGMA foreign_keys=ON` is set on each connection, so it's enabled on engine
  connect for the app and the tests.
- **Eager loading only.** Relationships are `lazy="raise"`, and the trip is
  assembled with `selectinload(...)` plus the soft-delete filter. A forgotten
  load fails loudly in tests instead of raising `MissingGreenlet` at runtime
  (lessons §11).
- **Time model** (lessons §3):
  - Plain dates are `DATE`.
  - Wall-clock values are a naive `DATETIME` plus a nullable IANA zone string.
    `null` means the trip's `timezone`; every override, including a travel's
    `arriveTimezone`, falls back to the trip's zone.
  - `Trip.timezone` is required, and every zone is checked with `zoneinfo`.
  - UTC instants are computed only to compare values in different zones (for
    example, arrive vs depart on a cross-zone flight). They are never stored
    for trip content.
- **Wall-clock format on the wire:** `YYYY-MM-DDTHH:MM`, seconds optional, no
  offset. A value with an offset or `Z` is rejected, and so is a non-string.
- **Import rules** (any failure rejects the import):
  1. `endDate ≥ startDate`.
  2. Every `days[].date` is within the trip range, with no duplicate dates.
  3. Activity `start`, when present, is on its day's date. `end` requires
     `start` and must come after it (same zone, so compared directly).
  4. A stay's `checkOut > checkIn`, compared as instants. `checkIn` falls
     within the trip range, and `checkOut` is no later than `endDate + 1 day`.
  5. A travel's `depart` is required and falls within the trip range. `arrive`
     is optional, must come after `depart` (as instants), and is no later than
     `endDate + 1 day`.
  6. Unknown fields are rejected (`extra="forbid"`), so typos fail loudly
     instead of being dropped.
  7. `lat` and `lng` are given together or not at all, and must be in range.
  8. File limit: 1 MB, UTF-8 JSON.
- **Day view composition** (`buildTimeline`):
  - Every date from `startDate` to `endDate` gets a row. A date with no day
    entry and no markers shows "No plans".
  - **Stay markers:** check-in on the check-in date, "Staying at" on each
    night strictly between, and check-out on the check-out date.
  - **Travel markers:** depart on the departure date. When the arrival date is
    later, an "Arrive" marker goes on the arrival date too.
  - **Ordering within a day:**
    - Activities keep their document order.
    - A timed marker goes just before the first *timed* activity that starts
      at or after it.
    - Untimed activities stay attached to whatever precedes them.
    - "Staying at" markers go first.
    - Markers at the same time are ordered check-out, then depart, then
      arrive, then check-in.
- **Frontend:**
  - Features: `features/trips/` (home, import, delete) and
    `features/timeline/` (trip view), one slice each.
  - Times are shown verbatim via `shared/utils/time.js`. Never call
    `dayjs(isoString)` on a wall-clock value.
  - `react-markdown` + `remark-gfm` render notes and summaries.
  - The dialog is hand-rolled in the template's shadcn *shape* (no Radix),
    matching the existing components.
- **The `things` example slice is removed** in Phase 2, once trips replace it as
  the reference slice.

## Open Questions / Design Decisions

All answered 2026-10-01/02 and folded into the body above.

1. **Stays at trip level?** **Answer:** yes. **Resolved:** stays are a
   trip-level list with their own rules, never derived into days.
2. **Markdown in notes/summaries?** **Answer:** yes. **Resolved:** rendered with
   `react-markdown` + `remark-gfm`.
3. **Keep template login and per-user ownership?** **Answer:** yes.
   **Resolved:** every trip is owned by a user; foreign trips return 404.
4. **Invalid import?** **Answer:** reject for now, relax later. **Resolved:**
   all-or-nothing, every error returned with its path.
5. **v1 material?** **Answer:** `reference/` folder. **Resolved:** done in
   Phase 0.
6. **Dates with no `days[]` entry?** **Answer:** show them (recommended).
   **Resolved:** every date in range renders, and an empty one shows
   "No plans".
7. **Overnight travel?** **Answer:** show on the arrival date (recommended).
   Then superseded by Q9: an arrival on a later date gets its own "Arrive"
   marker.
8. **Item order within a day?** **Answer:** document order (recommended).
   **Resolved:** activities keep document order; markers merge in by time
   (Q9).
9. **Travel at trip level too?** **Answer:** yes (2026-10-02). **Resolved:**
   `travels[]` is a trip-level list, items are activity-only, and `depart` is
   required so every leg can be placed.
10. **Trip deletion in the UI?** **Answer:** yes (recommended). **Resolved:**
    soft delete from the home screen, behind a confirm dialog.
11. **What does `make seed` load?** **Answer:** a sample trip (recommended).
    **Resolved:** the seed user gets the synthetic sample trip
    (`api/app/sample_data/sample_trip.json`), which is also the test fixture
    and the schema example.

---

## Phase 0 — Reset onto the template ✅

**Goal:** the repo is the template, green, with v1 knowledge preserved.

**Scope:**
- `rebuild` branch. Old code removed (it's still on `main`'s history and on
  `llm-translate`).
- Template tracked files dropped in via `git archive`.
- `reference/` holds the v1 docs, data and verify fixtures, plus a gitignored
  `private/` (old PDFs and notes, old `.env` backups).
- `docs/lessons_learned.md`, `functional_spec.md` and this plan.

**Tests / verification:**
- [x] `make setup`, `make seed`, `make verify` green (7 API + 7 UI tests)
- [x] API boots, `/health` ok, seeded user can log in and hit an authenticated
      endpoint; UI dev server serves on :3000

---

## Phase 1 — Crawl: Trip document, schema & models ✅

**Goal:** the trip document is defined, validated, published as a JSON Schema,
and has tables to land in.

**Scope:**
- `api/app/trip_document.py`:
  - `TripDocument`, `StayDoc`, `TravelDoc`, `DayDoc`, `ItemDoc`, `LocationDoc`,
    all with `extra="forbid"`.
  - `WallClock` and `IanaTimezone` types.
  - `validate_trip_document(data) -> TripDocument`, which raises
    `TripDocumentError([{path, message}, ...])` and covers both the structural
    errors and rules 1–7.
- `schema/trip.schema.json`, generated by `make schema` (`python -m
  app.schema_export`), with descriptions on every field and the rules in the
  root description.
- SQLAlchemy models `Trip`, `Stay`, `Travel`, `Day`, `Item` per the
  Architecture Decisions, with `PRAGMA foreign_keys=ON`.
- `api/app/sample_data/sample_trip.json`. It covers:
  - a cross-zone overnight flight
  - a stay spanning two nights
  - trains
  - timed and untimed activities
  - a date with no day entry
  - markdown notes
- Dependencies: `tzdata` (runtime) and `jsonschema` (tests).

**Out of scope:** endpoints, UI.

**Tests / verification:**
- [x] `make verify` passes
- [x] The sample trip validates. Mutated copies each fail with the expected
      path, at least one per rule 1–7.
- [x] The committed `schema/trip.schema.json` equals the generated one
- [x] The sample validates against the JSON Schema itself (`jsonschema`), and
      the schema rejects an unknown field and an offset wall-clock value
- [x] `make reset-db` creates the new tables

---

## Phase 2 — Crawl: Import & read API ✅

**Goal:** a trip document goes in through the API and comes back out in the
same shape.

**Scope:**
- `services/trips.py`: `import_trip(db, user_id, doc) -> Trip` (one
  transaction), `list_trips`, `get_trip`, `delete_trip` (soft).
- `routers/trips.py`:
  - `POST /trips/import`: multipart `file`, or a raw JSON body for curl/tests.
    Returns 201 with the trip summary.
  - `GET /trips`: summaries with counts, soonest start first.
  - `GET /trips/{id}`: the full document plus ids.
  - `DELETE /trips/{id}`: 204, soft delete.
  - `GET /schema/trip`: unauthenticated, read-only.
- Error responses:
  - 422 `{detail, errors: [{path, message}]}` for an invalid document.
  - 400 for malformed JSON or a missing file.
  - 413 for a file over 1 MB.
- Remove the `things` slice on the backend. (The frontend half moved to Phase 3,
  where its replacement page lands, so no commit has a home page without an
  API.) Seed replants the sample trip.

**Tests / verification:**
- [x] `make verify` passes
- [x] `make seed` covers this phase's new data, and the result is visible in the app (via API)
- [x] Round trip: import the sample, then `GET` equals the input (ignoring ids
      and audit fields)
- [x] Importing the same file twice creates two distinct trips
- [x] An invalid doc returns 422 with all errors and leaves no rows behind;
      bad JSON returns 400; an oversize file returns 413
- [x] Another user's trip returns 404 on GET and DELETE; an anonymous request
      returns 401
- [x] A deleted trip disappears from `GET /trips` and returns 404 on `GET /trips/{id}`

---

## Phase 3 — Crawl: Home screen (trip select & import) ✅

**Goal:** after logging in, I see my trips, can import a new one, and can open
or delete one.

**Scope:**
- `features/trips/`: a trips slice (list, import, delete) and `TripsPage` at
  `/`.
  - Cards show name, date range, nights, and stay/travel counts.
  - An empty state has an "Import trip" button.
- An import dialog: file picker → upload.
  - Success: toast, then navigate to `/trips/:id`.
  - Failure: the dialog shows a path → message list.
- Delete through a confirm dialog with a destructive button.
- Remove the frontend `things` slice; `TripsPage` replaces `DashboardPage`.
- `shared/utils/time.js` (wall-clock and date formatting) with tests.

**Tests / verification:**
- [x] `make verify` passes
- [x] `make seed` covers this phase's new data, and the result is visible in the app
- [x] Component tests: list renders, empty state, import success navigates,
      import failure shows path-tagged errors, delete confirms first
- [ ] Manual: phone width (375px), dark theme, keyboard focus visible. (Agent checked
      headless screenshots at 375px; a human look is still the gate.)

---

## Phase 4 — Crawl: Trip timeline ✅

**Goal:** the trip reads well as an expandable day-by-day timeline.

**Scope:**
- `features/timeline/`: `TripTimelinePage` at `/trips/:id`.
  - Header: name, dates, timezone, and a back link.
  - Day rows show date, weekday and title, collapsed by default. Expanding
    shows the summary (markdown) and the day's entries.
  - Entry rows show an icon by kind and travel mode, the time (wall clock, with
    a zone label when it differs from the trip's), and the title. Expanding
    shows notes (markdown), location with a maps link, confirmation number, and
    travel details.
- `buildTimeline(trip)`: a pure function implementing the day-view
  composition rules above.
- Loading skeleton, and a not-found state.

**Tests / verification:**
- [x] `make verify` passes
- [x] `make seed` covers this phase's new data, and the result is visible in the app
- [x] `buildTimeline` unit tests:
      - a multi-night stay puts its markers on the right dates
      - an overnight cross-zone flight shows on both dates
      - empty dates
      - document order kept
      - markers merge in by time around untimed activities
- [x] Wall-clock formatting doesn't depend on the process `TZ`
- [x] Component tests: expand/collapse a day and an entry; markdown renders
- [ ] Manual: phone width, long titles wrap cleanly, dark-theme contrast. (Agent
      checked headless 375px screenshots with the browser set to
      Pacific/Auckland; a human look is still the gate.)

---

## Walk stage — editing day activities

Scope: create, update and delete **activities** (`days[].items[]`). Stays and
travels stay read-only. Their markers get no edit controls.

### Design (assuming the recommended answers below)

- **One write path:** every edit goes through new functions in
  `services/trips.py`.
- **Shared validation:** an edited activity is validated by the same code as an
  import.
  - The body is an `ItemDoc`, so structure and unknown-field rules are
    identical.
  - The per-activity rule (start on the day's date, end after start) is
    factored out of `check_rules` into `check_item`, which both import and edit
    call.
- **Full replace, not patch:** the form always sends the whole activity, so
  there's no absent-vs-null ambiguity (lessons §8).
- **Writes return the updated trip** (`TripRead`). The UI swaps it into state
  in one round trip, so nothing goes stale and `buildTimeline` just re-runs.
- **Endpoints**, all behind `get_owned_trip`. An activity on another trip, or a
  deleted one, returns 404.
  - `POST   /trips/{id}/items` takes an `ItemDoc` plus `date` and creates the
    activity at the end of that date. It creates the day row if the date has
    none. (The date is in the body rather than the URL, so create and replace
    take the same shape.)
  - `PUT    /trips/{id}/items/{item_id}` replaces an activity. If its `date`
    changes, it moves to the end of that day.
  - `DELETE /trips/{id}/items/{item_id}` soft-deletes it and returns the
    updated trip, like every other edit.
  - `PUT    /trips/{id}/days/{date}` sets the day's title and summary,
    creating the day row if needed (Q5).
  - `POST   /trips/{id}/items/{item_id}/move` with `{ "direction": "up" |
    "down" }` swaps the activity with its neighbour within the day.
- **UI:**
  - An "Add activity" button sits under each day's list.
  - An expanded activity shows Edit, Move up/down and Delete.
  - Edit and add use one hand-written `ActivityForm` in the Dialog, shaped as a
    bottom sheet on a phone. Fields:
    - Title
    - Day (select)
    - Start and end time
    - Location: name, address, link
    - Confirmation number
    - Notes (markdown textarea)
  - The form validates on submit. Server 422 paths are mapped onto the fields
    inline.
  - Delete asks for confirmation. Every write shows a toast.

### Phase 5 — Walk: activity edit API ✅

- `check_item` extracted; `create_item`, `replace_item`, `delete_item` and
  `move_item` added to `services/trips.py`; routes added.
- Tests:
  - Create on an existing day, and on a date with no day row.
  - Replace, including a move to another day.
  - 422 with paths.
  - Delete hides the activity from `GET`.
  - Move up/down, including at the ends of the list.
  - Foreign or deleted items return 404; anonymous requests return 401.
  - Import and edit reject the same bad activity the same way.

### Phase 6 — Walk: activity editing UI ✅

- `ActivityForm` (time inputs on the day's date; end before start rolls to
  the next day).
- Edit, add, move and delete wired into `TimelineEntry` and `DayPanel`, with
  `timelineSlice` thunks that replace the trip.
- Tests:
  - Add, then edit, then delete, with mocked API calls.
  - Inline field errors from a 422.
  - Markers have no edit controls.
  - Phone-width check. (Agent: a live add/edit run at 375px, with the save
    confirmed through the API. A human look is still the gate.)
- Also fixed: the Dialog re-ran its focus effect on every render, which pulled
  focus out of form fields mid-typing.

### Open questions (editing)

1. **Where do the edit controls live?**
   - (a) Inside an expanded activity, plus an "Add activity" button under each
     day.
   - (b) An "Edit day" mode that shows controls on every activity at once.
   - Recommendation: **(a)**. It reads cleanly and needs no mode.
   - **Answer:** recommended (2026-10-02).
2. **Reordering untimed activities: now or later?** Their position matters,
   because a marker merges in around them.
   - Options: Move up/down buttons now; drag-and-drop (needs a touch DnD
     library); or later.
   - Recommendation: **Move up/down now**.
   - **Answer:** recommended (2026-10-02).
3. **Move an activity to a different day?**
   - Recommendation: **yes**, via a Day select in the form. The activity lands
     at the end of the new day.
   - **Answer:** recommended (2026-10-02).
4. **Adding to a date with no day entry** (like May 10). A day row needs a
   title today.
   - (a) Make `DayDoc.title` optional. The tab and heading already fall back to
     the date. This is a small schema change, and the schema regenerates.
   - (b) Ask for a title when adding the first activity.
   - Recommendation: **(a)**.
   - **Answer:** recommended (2026-10-02).
5. **Edit the day's own title and summary now too?**
   - It's cheap with the same pattern (`PUT /trips/{id}/days/{date}`).
   - Recommendation: **yes**, as a small "Edit day" button in the panel
     header.
   - **Answer:** recommended (2026-10-02).
6. **Time entry.** The form takes times only, with the date coming from the
   day.
   - Recommendation: an end time earlier than the start rolls to the next day
     (22:00–01:00), shown as "+1".
   - **Answer:** recommended (2026-10-02).
7. **Timezone override and coordinates on an activity.**
   - Recommendation: **not in the form for now**. Existing values are
     preserved on save, and the map link uses the address when there are no
     coordinates. Places lookup is later.
   - **Answer:** recommended (2026-10-02).
8. **Write semantics.** Full replace (PUT) of the whole activity, or PATCH?
   - Recommendation: **PUT**.
   - **Answer:** recommended (2026-10-02).

## Walk stage 2 — editing stays & travel, location-based timezones, vertical timeline ✅ (live Google Places check pending a key)

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

## Phase 10 — Walk: collapsed day rows with cities ✅

The date strip didn't earn its space, especially with days collapsed. The
timeline becomes the whole page.

**Scope**
- Remove the sticky date strip (`DateJumper`) and the scroll observer.
- Every day starts collapsed, and every date gets the same row (no slim "No
  plans" variant). The row is one button:
  - the date on the left, and the day's cities on the right ("Bern → Wengen");
  - underneath, the title in bold followed by the summary
    ("**Arrive in Bern** — Land in Zürich, …"), or whichever of the two exists.
- Tapping the row opens the day: entries (each still expandable), Add, and
  Edit day. Any number of days can be open at once.
- `?day=YYYY-MM-DD` opens that day and scrolls to it. Tapping doesn't rewrite
  the URL.
- **Cities.** They come from the day's entries in timeline order:
  - travel gives its from and to places, and an overnight arrival gives its to
    place;
  - stay markers give the stay's place;
  - activities give their place.

  Repeats in a row are merged. A place whose city can't be judged adds nothing,
  and a day with none shows nothing on the right.
- **Where a place's city comes from.**
  - A new optional `city` on `LocationDoc`. It isn't editable: it's set from
    Google's address components (`locality`, else `postal_town`) when a place is
    picked, and kept when the place is renamed.
  - When `city` is missing (imports, typed names), a cautious guess is taken
    from `address`: the second-to-last comma part with postal-code tokens
    removed, skipping a US-style state code. With no address, there's no city.

**Tests**
- API: `city` round-trips through import and edits, and the schema includes it.
- UI unit: `cityOf` (stored city, address guesses, nothing to judge) and
  `dayCities` (order, merging, overnight arrival).
- Page:
  - days start collapsed, and the row shows the date, cities, title and summary;
  - tapping opens a day;
  - `?day=` opens and scrolls to that day, and an unknown date is ignored.
- The editing tests open the day before editing.
- A live browser check at phone width.

## Phase 11 — Walk: day detail pages ✅

Editing controls and a day's entries cluttered the trip overview once days
could hold a lot. A day gets its own page.

**Scope**
- `DayRow` (was `DayCard`): the trip page's row is now a plain link to
  `/trips/:id/days/:date` — date, cities, title, summary, nothing else.
- `DayDetailPage`: that date's entries, add/edit/delete for activities, stays
  and travel, and the day's own title/summary. Prev/next day links (styled as
  real buttons, not text links, so they don't read as the "back to trip" nav
  above them); a fallback for a date outside the trip.
- `RailDot`: the dot-and-line rail factored out of the old `DayCard`, shared
  between the trip page's day rows and the day page's entry rows — one dot
  per entry, by time, instead of one per date.
- The `?day=` deep link on the trip page is dropped; a day's own URL replaces
  it.

**Tests**: `TripTimelinePage.test.jsx` trimmed to overview concerns; new
`DayDetailPage.test.jsx` for the day page's own view/navigation; editing
tests (`TimelineEditing.test.jsx`, `BookingEditing.test.jsx`) updated to
render the day page directly. A live Playwright pass.

## Phase 12 — Walk: stays/travel coverage views ✅

"Just a visual way to see what nights we have a hotel for."

**Scope**
- `coverageView.js`: `stayCoverage(trip)` — a stay covers the *night* of date
  D when its check-in date <= D < its check-out date, first stay claiming a
  date wins. `travelCoverage(trip)` — a date is covered by a leg's depart
  date, plus its arrival date too when it lands later; same-day legs (normal
  for travel, e.g. a connection) join into one label and carry every record,
  keeping the first leg's color.
- A fixed 8-color categorical palette (`--series-1`..`8` in `index.css`,
  `bg-series-1`..`8` in Tailwind) — the dataviz skill's dark-surface
  reference palette, converted to this app's HSL token convention and
  re-validated with its script. Color is assigned by position, never by
  rank; the name is always shown as text too, since this app has no light
  theme to also validate.
- `RailDot` no longer takes a fixed `tone` enum; it takes any `bg-*` class,
  so day rows can show a categorical color instead of primary/warning/muted.
- Two icon buttons (House, Plane) next to the trip title switch the trip
  overview between plan/stays/travel — exactly one at a time, the selected
  one filled (not just a subtler `secondary` shade — needed to read clearly
  as "pressed" at icon-button size).
- **Adding/editing moved off the day page, into these views.** Selecting a
  date opens a read-only `BookingDetailsDialog` quick look when a stay/leg
  already covers it (name, dates, location with a mini-map, confirmation,
  notes, an "Edit" button) — never straight to the edit form. An uncovered
  date opens the add form, prefilled for that date. A date with more than
  one travel leg falls back to the day page, the only place that lists both.
  The day page's Add button is now just "Add activity"; existing stay/travel
  markers on a day are still edited/deleted from there.
- `runEdit.js` factors the thunk-dispatch-to-`{ok}`/`{errors}` helper shared
  by `TripTimelinePage` and `DayDetailPage`.

**Tests**: `coverageView.test.js`; `TripTimelinePage.test.jsx` covers the
toggle; `CoverageEditing.test.jsx` (new) covers adding/opening from the
coverage views, including the two-legs-same-date fallback. A live Playwright
pass, including the stays/travel screenshots.

## Walk stage 3 — location photos, bottom nav & map view

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

## Run stage 1 — map place search & add-from-map; installable offline app

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

## Run stage 2 — "find it fast": Today tab, landing, drawer, details, search

From `ui_review.md`, discussed with Julian on 2026-10-03.

**Decisions** (2026-10-03):
- **Landing.** The app opens on the next trip that matters: the active one,
  else the next upcoming one, on its **Today** tab. With no such trip it
  opens the trips list.
- **Navigation.** The trips list moves to `/trips`, behind a **nav drawer**
  (☰). The drawer holds All trips, Install app, Admin (for admins) and Sign
  out.
- **The tab bar is stable: Today | Timeline | Map.** Map stays a tab, not a
  drawer item.
- **Today is always shown for now**, so it's easy to test. When the trip
  isn't under way, it previews the trip's **first day**, and says so.
  Hiding the tab outside an active trip is a later switch on the whole
  view.
- **Today shows, in order:**
  1. **Next up:** the next booking or timed activity, with its key facts,
     the confirmation number (with copy) and Directions.
  2. **Tonight:** that night's stay, plus this morning's check-out on a
     changeover day.
  3. **Today's plan:** that day's entries.
  4. A link to **tomorrow**.
- **Past days are greyed** on the timeline, and today's row is marked
  "Today". Entries *within* a day are **not** greyed, because many
  activities have no time.
- **Details are reorganized, and the list rows don't change.** One shared
  `EntryDetails` component is used by the day page's expanded entries, the
  stays/travel quick look and the Today tab. Its order:
  1. booking facts and the **confirmation number** at the top;
  2. notes;
  3. places (address and open-in-maps);
  4. photos last, as small thumbnails;
  5. no photos for travel endpoints.
- **Search** is an icon in the trip's top bar. It opens a full-screen search
  over the whole trip: titles, notes, confirmation numbers, carriers,
  numbers, place names and addresses. Results are grouped by day, and
  tapping one opens that day with the entry expanded. It's all on the
  device, so it works offline.
- **Day page:**
  - "Day N of M";
  - prev/next at the bottom too;
  - swipe left/right between days;
  - the "← Trip" link is dropped (the top bar and the Timeline tab cover
    it).
- **Trip header:** a "Plan | Stays | Travel" segmented control replaces the
  House/Plane icons. Julian sees before/after screenshots and may revert
  it.
- **Trips list:** grouped Active (hidden when empty), then Upcoming
  (soonest first), then Past (most recent first, collapsed behind "Past
  (n)"). Delete moves into a "⋯" menu.
- **Tidy-ups:**
  - the "Times are local (… unless noted)" header line is dropped;
  - "Open map" and "Website" links get a full-size tap target.
- **Dropped:** "Locate me". Directions hand off to the phone's maps app,
  which already shows where you are and works offline.
- **Next follow-up:** a text-size preference that also scales the timeline
  rails and dots.

### Phase 20 — Run: landing, drawer, trips grouping ✅

- `/` resolves to a trip (`pickLandingTrip` in `tripDates.js`) and redirects
  to its Today tab, or to `/trips` when there's none. `TripsPage` moves to
  `/trips`.
- `TopBar`, with ☰ and a title, on the trip pages and the trips list.
  `NavDrawer` is a hand-rolled slide-in panel in the dialog's shadcn shape.
  Install, Admin and Sign out move into it.
- Trips grouped by `tripPhase`; Past collapsed; delete through a "⋯" menu
  (with the same confirm dialog as before).
- The tidy-ups: the header line, and the link tap targets.
- **Tests:**
  - `pickLandingTrip` (active, then the next upcoming, then none);
  - the grouping and its order;
  - Past collapsed;
  - delete through the menu;
  - the drawer's links;
  - `/` redirects.

### Phase 21 — Run: the Today tab and greyed past days ✅

- `/trips/:id/today` and a third tab.
- `todayView.js` (pure):
  - `referenceDay(trip, now)` gives `{ date, active }`: today on the trip's
    calendar while it's under way, else the first day (the preview).
  - `nextUp(trip, ref, now)` finds the next stay check-in or check-out,
    travel departure, or timed activity at or after "now". Each one is
    compared on its own place's clock. A preview starts at 00:00 on the
    first day.
  - `tonight(trip, date)` gives that night's stay and any check-out that
    morning.
- `DayRow` takes `past` and `today` flags.
- **Tests:**
  - `todayView` unit tests: a cross-zone "now", a preview, a changeover
    day, nothing left today;
  - `TodayPage` component tests;
  - greyed rows.

### Phase 22 — Run: shared EntryDetails, reordered ✅

- `EntryDetails` (facts, then confirmation, then notes, then places, then
  thumbnails) used in `TimelineEntry`, `BookingDetailsDialog` and Today.
  `LocationBlock` becomes `PlaceRow`, a compact place row with a 64px
  thumbnail. The mini-map fallback is gone from the details; it's still in
  `PlaceField` while picking. The facts gain Room (stays) and Seat (travel),
  and a leg without an arrival says "Not set yet".
- **Tests:** the order of the sections, no photo for travel endpoints, and
  the existing editing and coverage tests still pass.

### Phase 23 — Run: trip search ✅

- `tripSearch.js` (pure) searches the timeline entries.
- `TripSearch` is a full-screen overlay opened from the top bar.
- `?open=<entry key>` on the day page expands the entry and scrolls to it.
- **Tests:** matching each field, grouping by day, an empty result, and the
  deep link opening the entry.

### Phase 24 — Run: day navigation and the segmented control ✅

- "Day N of M", prev/next at the top and bottom, swipe (a touch handler
  with a distance threshold; vertical scrolling isn't hijacked). The
  "← Trip" link is dropped.
- The "Plan | Stays | Travel" segmented control, with before/after
  screenshots.
- **Tests:** the day counter, the bottom links, swipe navigation (touch
  events), and the segmented control's pressed state.

Each phase: `make verify` green, a live Playwright pass with screenshots at
375px, PROGRESS updated, a commit.

**Built (2026-10-03):** all five phases, one commit each.
- `make verify`: 115 API + 196 UI. `ui/e2e/trip.spec.js` (10 tests) passes
  live.
- The timeline page keeps the trip name as its heading, so its top bar
  doesn't repeat it (`showTitle={false}`). The other trip pages show it in
  the top bar.
- Swipe ignores touches from the portaled edit dialogs (React bubbles
  portal events), so swiping inside a form never changes the day.
- Before/after of the segmented control:
  `ui/e2e/screenshots/compare-segmented-control.png` (gitignored, local
  only). Julian may revert it.
- **Waiting on:** Julian's look at 375px.

## Run stage 3 — sharing a trip, and the trip journal (memories)

Asked 2026-10-03 (Julian):
- **Sharing.** Two roles, **owner** (who created the trip) and **viewer**
  (the person the trip was planned for, "the pripri"). For now only the
  owner can edit, so there are no conflicts to handle. The owner can see the
  trip's id. The trips page gets a **Join** button: enter a trip id to join
  as a viewer.
- **Trip journal:** a shared account of the trip as it's experienced, made
  of **memories**.
  - A memory is a point-in-time note: a meal, a museum, a funny joke.
  - Memories are recorded per user. The journal only ever grows.
  - They're ordered by **creation time, set in UTC**.
  - Only a memory's author can edit or delete it.
  - Start simple: a "New memory" button on the Today tab, plain-text notes.
    Get the time and the ordering right first. Location, pictures and more
    come later.
- **Descoped for now:** pictures. Storing them is a bigger infrastructure
  decision, probably object storage beyond the Fly volume.

**Decisions** (answered 2026-10-03, and folded into the design below):
- **Join with the trip's id**, as Julian first asked. A separate join code
  was considered and skipped: with this few users, the extra table,
  endpoints and UI aren't worth it. The owner can still remove a viewer.
- A viewer editing gets **403**; a stranger gets 404. The owner sees and
  removes viewers, and a viewer can leave. Viewers see everything, with no
  edit controls. A seed viewer exists for trying it locally.
- A memory's time shows in **its author's zone at writing** (stored with
  it). Everyone on the trip sees everyone's memories. The journal is a
  **fourth tab**: Today | Timeline | Journal | Map. Julian is wary of a busy
  tab bar, but memories are spur-of-the-moment, so a tab for now.
- An author shows as their **email** for now.
- **Offline capture is deferred:** writing a memory needs a connection.
- Plain text up to 2,000 characters, and "edited" on a changed memory.

### Design

**Data: new tables only.** Nothing is added to the existing tables. The app
creates missing tables when it starts (`create_all`), so this lands
**without** a `make reset-db`, and the real Okinawa trip in the dev database
survives.
- **`trip_members`:**
  - `id` (UUID), `trip_id`, `user_id`, `role` (`"viewer"` for now) and
    `created_at` (`UtcDateTime`), plus soft delete;
  - unique on `(trip_id, user_id)` among live rows.
  - The owner stays `trips.user_id`, with no member row, so every existing
    query and ownership rule keeps working unchanged.
- **`memories`:**
  - `id` (UUID), `trip_id`, `user_id` (the author) and `text`
    (1–2,000 characters after trimming);
  - `created_at` (`UtcDateTime`): set by the server, never sent by the
    client, and the **only** ordering key, with `id` as the tiebreak;
  - `zone`: the author's IANA zone at that moment, which the browser
    reports, used only for display;
  - `updated_at` (`UtcDateTime`, nullable), plus soft delete.
  - An edit never changes `created_at`, so editing never reorders the
    journal.

**Access: one place, two levels.** This follows the template's
`get_owned_resource` pattern.
- `get_viewable_trip` lets in the owner **or** a live member, and gives 404
  to everyone else. Every read uses it: the trip, the trip list, memories,
  and the offline cache's fetches.
- `get_owned_trip` is unchanged and owner-only. Every trip edit keeps it,
  so viewers can't edit by construction. A viewer who tries to edit gets
  **403** (they know the trip exists); a stranger still gets 404.
- `get_own_memory` gets the memory through a viewable trip and checks
  `memory.user_id == user.id`, else 403. It's used for editing and
  deleting memories.
- A response that says who someone is gives their email (no names yet),
  and nothing else about them.

**API:**
- **Trips:**
  - `GET /trips` returns owned **and** joined trips, each with `role`
    (`"owner"` | `"viewer"`).
  - `GET /trips/{id}` (`TripRead`) gains `role`, so the UI knows whether it
    can edit.
- **Sharing:**
  - `POST /trips/join` with `{ tripId }` joins as a viewer and returns the
    trip summary. Joining twice does nothing new. An unknown or deleted trip
    gets 404. The owner joining their own trip gets 409.
  - `GET /trips/{id}/members` (owner) lists the viewers with their emails
    and join dates. `DELETE /trips/{id}/members/{user_id}` (owner) removes one.
  - `DELETE /trips/{id}/membership` lets a viewer leave.
- **Journal:**
  - `GET /trips/{id}/memories` returns every member's memories, oldest
    first (by `created_at`, then `id`), each with the author's email, `mine`,
    `createdAt`, `zone` and `updatedAt`.
  - `POST /trips/{id}/memories` takes `{ text, zone }`; the server stamps
    `created_at` in UTC.
  - `PUT` and `DELETE /trips/{id}/memories/{memory_id}` are author only.
    Deleting is soft.

**UI:**
- **Read-only for viewers.** `selectReadOnly` becomes "offline, or a saved
  copy, **or** `role === "viewer"`". Every edit control already uses it, so
  viewers see the trip with no edit controls (hidden, not just greyed).
- **Memories** have their own rule, `selectCanWriteMemory`: online and a
  member. A viewer can write memories but can't edit the trip.
- **Sharing:**
  - The trips page's Join button opens a dialog to paste the trip id.
    After joining it shows a toast and opens the trip.
  - The owner gets a **Share trip** button in the trip's top bar. It opens
    a dialog with the trip id (with copy) and the viewers (with Remove).
  - A viewer's ⋯ menu on the trips list says **Leave trip** instead of
    Delete.
  - Trip cards say "Shared with you" for viewers.
- **Journal:**
  - The Today tab gets a **New memory** button, which opens a textarea
    dialog. Saving shows a toast, and the memory appears at once.
  - A **Journal** tab groups memories by day. A
    memory's day is its local date in the zone it was written in. Inside a
    day they run oldest first.
  - Each memory shows its time (with "Tokyo time" when it differs from the
    trip's zone), its author, and "edited" if it was.
  - Your own memories have a ⋯ menu with Edit and Delete (Delete asks
    first).
  - Memories written before the trip starts or after it ends go in "Before
    the trip" and "After the trip" groups.
- **Offline:** memories are cached with the trip and readable offline.
  Writing one needs a connection for now (offline capture is deferred).

**Time and ordering, the part to get right:**
- `created_at` is an **instant** (`UtcDateTime`), stamped by the server.
  The ordering never depends on a phone's clock or zone.
- The display zone is stored, not inferred, so a memory written in Tokyo
  still reads "8:14 PM Tokyo time" when viewed later from Chicago.
- **Tests pin this down:**
  - two memories written a second apart in different zones order by
    instant, not by local wall clock;
  - an edit keeps a memory's place;
  - day grouping is right across midnight and the date line (a memory
    written at 00:30 Tokyo time is that Tokyo date);
  - a bad zone is rejected (checked with `zoneinfo`, like the trip's).

### Phase 25 — Run: sharing API

- `trip_members`, `get_viewable_trip`, the 403/404 split,
  and `role` on the trip list and `TripRead`.
- The join, members, remove and leave endpoints.
- `make seed` gains a second traveler (`SEED_VIEWER_EMAIL` and
  `SEED_VIEWER_PASSWORD`) who joins the sample trip, so both roles can be
  tried locally (Q-S5).
- **Tests:**
  - a viewer can read but every edit route gives 403, and a stranger gets
    404 everywhere;
  - joining (twice, an unknown trip, a deleted trip, the owner's own
    trip);
  - remove and leave;
  - the list shows joined trips with their role;
  - a soft-deleted trip disappears for viewers too.

### Phase 26 — Run: sharing UI ✅

- The Join dialog, the owner's Share dialog (the trip id with copy, and the
  members with Remove), and Leave trip.
- Read-only for viewers through `selectReadOnly`, and the "Shared with you"
  label.
- **Tests:**
  - the viewer UI has no edit controls;
  - joining opens the trip;
  - the share dialog's id and member removal;
  - leaving removes the trip from the list.
- **Live:** two browser contexts, owner and viewer, in Playwright.

### Phase 27 — Run: memories API ✅

- The `memories` table, the endpoints, `get_own_memory`, and the zone check.
- **Tests:**
  - only the author can edit or delete (403 for another member, 404 for a
    stranger);
  - the ordering is by server UTC instant, and an edit doesn't reorder;
  - the text limits;
  - a viewer can create;
  - deleted memories are hidden.

### Phase 28 — Run: memories UI ✅

- New memory on Today, the Journal view grouped by day, edit and delete
  your own, and caching the journal for offline reading.
- `journalDays(memories, trip)` is pure and groups by the local date in
  each memory's zone, with the before/after groups.
- **Tests:**
  - `journalDays` across midnight and the date line;
  - the before/after groups;
  - an edit keeps its place;
  - only your own memories show Edit and Delete;
  - New memory is disabled offline.

**Built (2026-10-03):** Phases 25–28, one commit each (plus a mypy fix
after 25).
- `make verify`: 133 API + 217 UI tests. `ui/e2e/trip.spec.js` (12 tests,
  owner and viewer in two browser contexts) passes live.
- The new tables are created at startup, so no `make reset-db` was needed;
  `make seed` adds the viewer.
- **Waiting on:** Julian's look at 375px, and a real two-phone test after
  the Fly deploy.

### Open questions (Run stage 3)

Sharing:

- **Q-S1. What does a viewer enter to join?**
  - (a) The trip's id, as asked. It works, but the id is in every trip URL
    (`/trips/<id>/…`), so anyone who sees a link or screenshot of a URL can
    join, and it can never be revoked.
  - (b) A separate **join code** the owner sees on a Share screen. It's
    random and unguessable, and "New code" revokes the old one.
  - Recommendation: **(b)**. It's the same flow (copy it, send it, paste it
    into Join) and costs one small table.
  - **Answer:** the trip id: a join code isn't worth the extra effort for this few users (2026-10-03).
- **Q-S2. What happens when a viewer tries to edit?**
  - Recommendation: **403** for a member and 404 for a stranger. In
    practice the UI never offers them an edit control anyway.
  - **Answer:** yes (2026-10-03).
- **Q-S3. Managing who's on the trip.**
  - Recommendation: the owner sees the viewers and can remove one, and a
    viewer can leave.
  - **Answer:** yes (2026-10-03).
- **Q-S4. What does a viewer see?**
  - Recommendation: **everything**, including confirmation numbers, since
    the viewer is a traveler. Edit controls are **hidden** for viewers, not
    greyed as they are offline, because a viewer can never edit.
  - **Answer:** yes (2026-10-03).
- **Q-S5. A second dev user to try sharing locally?**
  - Recommendation: **yes**, a seed "viewer" user who has already joined
    the sample trip.
  - **Answer:** yes (2026-10-03).

Journal:

- **Q-J1. Which clock does a memory's time show in?** The instant is UTC
  either way, which settles the ordering.
  - (a) The trip's zone.
  - (b) The viewing phone's current zone.
  - (c) **The zone the author's phone was in when they wrote it**, stored
    with the memory.
  - Recommendation: **(c)**. A dinner in Tokyo should read 8 PM even when
    you reread it in Chicago, and phones switch zone automatically while
    traveling.
  - **Answer:** yes, (c) (2026-10-03).
- **Q-J2. Who sees whose memories?**
  - Recommendation: **everyone on the trip sees everyone's**, labelled by
    author. That's what makes it a shared journal. Only the author can edit
    or delete.
  - **Answer:** yes (2026-10-03).
- **Q-J3. Where does the journal live?**
  - (a) A fourth tab: **Today | Timeline | Journal | Map**.
  - (b) A section on Today (today's memories) plus each day page.
  - (c) Both: a Journal tab for the whole story, and each day's memories
    on its day page.
  - Recommendation: **(a)** now, then (c) once memories carry a location or
    an event.
  - **Answer:** (a) a tab for now; Julian is wary of a busy tab bar (2026-10-03).
- **Q-J4. How is the author named?** Accounts have an empty `name` today.
  - Recommendation: show the name when it's set, else the part of the email
    before the @. Add a "Your name" field in the drawer.
  - **Answer:** just the email for now (2026-10-03).
- **Q-J5. Writing a memory offline?** It's the most likely moment to want
  one: no signal on a mountain.
  - Recommendation: **online-only for this stage**. Offline capture is the
    first thing after it: an outbox, with the UUID made on the phone so a
    retry can't create a duplicate.
  - The catch: offline capture needs the *phone's* time as the creation
    time (validated as not in the future), which bends "set in UTC by the
    server". Decide that when we get there.
  - **Answer:** deferred (2026-10-03).
- **Q-J6. Limits and wording.** Plain text up to 2,000 characters, and
  "edited" shown on a changed memory.
  - Recommendation: as stated.
  - **Answer:** yes (2026-10-03).

## Run stage 4 — the journal, offline and in place: offline memories, location, photos

Asked 2026-10-03 (Julian):
- **Offline first:** write memories with no signal. The phone's clock is
  trusted (NTP, re-synced when you land), so the device stamps the time
  when you tap Save. Add a server-side "created on" field anyway, in case
  it's needed later.
- **Location:** ask for the user's location and attach it to a memory.
  Also the blue "you are here" dot on the map.
- **Photos:** from the gallery or the camera, stored on a Fly volume as an
  attached file store, not as base64 in the database.

**Decisions** (answered 2026-10-03: "go with your recommendations", plus
Julian's notes on storage and photo quality). Built on the
`journal-memories` worktree and branch, stacked on `rebuild`, which is
being deployed to Fly separately.
- The phone's time orders the journal. The server's `received_at` is kept
  as "created on". A device time more than 10 minutes in the future is
  clamped, not rejected.
- Offline: new memories, edits and deletes all queue.
- Location is on by default once allowed, with a per-memory chip to remove
  it. It's asked for when the first memory is saved, and shown as the
  nearest trip place within about 250 m, else a map link. Memories become
  their own pins on the map, with a toggle.
- **Photos are stored on a Fly volume, grown to about 10 GB.**
  - **Full quality is kept:** the original as uploaded, plus a 2560 px
    display copy and a 480 px thumbnail made by the **server**.
  - At most 10 per memory and about 25 MB each. Memories only.
- **Photo URLs are unguessable rather than signed.** Each URL contains the
  photo's random UUID and is served without a login check. That's the same
  risk Julian accepted for joining by trip id, and it makes caching trivial.
  Signed URLs can be added later without changing storage.
- **Offline:** thumbnails are always cached, and display copies once
  viewed, up to a cap. Originals only online.
- **Backups:** Fly's daily snapshots for now. An off-site copy (for example
  a nightly pull to the Pi) comes before relying on it for a real trip.

### Design

**1. Offline memories: an outbox.** The complexity isn't the timestamp,
which is easy. It's making a write that happens with no server reliable
later.
- **The phone makes the ids.** A memory's `id` (a UUID) and `createdAt` (UTC
  ISO, from `Date.now()` at Save) are made on the phone and sent with it.
  The server treats `POST` with an existing id as "already have it": same
  response, no duplicate. So a retry after a dropped connection (did it
  save or not?) can never create two.
- **The outbox:** an IndexedDB store of pending operations (`create`,
  `update`, `delete`), per user.
  - A new memory shows in the journal **at once**, marked "Waiting to sync".
  - Editing or deleting a not-yet-synced memory rewrites its outbox entry
    instead of queueing a second operation.
  - Only the author edits, so there are no conflicts to merge. The last
    write per memory wins.
- **When it sends:**
  - when the phone comes back online;
  - when the app opens or comes to the foreground;
  - after each new save;
  - on a back-off retry.

  It doesn't use Background Sync, which iOS doesn't support, so sending
  happens while the app is open. That's fine for "the second they land".
- **Expired login:** a 401 while sending keeps the outbox. After signing
  in, it sends. **Sign out** with pending memories warns first ("2
  memories haven't synced. Sign out anyway?").
- **Server:**
  - `created_at` becomes **the device's** time and stays the ordering key.
  - A new `received_at` is the server's own UTC stamp (your "created on",
    kept just in case).
  - A device time more than 10 minutes in the future is **clamped to
    `received_at`** rather than rejected. A rejection would leave a memory
    stuck in the outbox forever.
  - Ties are broken by `id`, as now.
- **Ordering caveat (accepted):** two phones with clocks a few seconds apart
  can interleave slightly. That's fine for a journal.

**2. Location.**
- **The API:** `navigator.geolocation` (the browser's built-in location).
  - It needs **HTTPS**; `localhost` is fine for development.
  - The browser asks permission once, and an installed iOS app may ask
    again occasionally.
  - **GPS works with no signal.** It's slower to get a first fix without
    data, but it works.
- **When to ask:** the first time someone saves a memory, not when the app
  opens. Asked in context, people say yes.
  - Saving **never waits** on location: it waits up to about 8 seconds,
    accepts a reading up to a minute old, and saves without one if location
    is denied or too slow.
  - The memory dialog shows a removable 📍 chip ("Near Kornhauskeller" or
    "Location attached"), so a single memory can go without.
- **Stored** on the memory: `lat`, `lng` and `accuracy` (in metres).
- **Shown as the nearest place on the trip** within about 250 m ("near
  Hotel Goldener Schlüssel"). That works offline and is free. Otherwise
  it's a "Show on map" link. Google reverse geocoding (turning coordinates
  into a street or place name) could come later.
- **The blue dot:** `watchPosition` while the map is open, an Advanced
  Marker dot, and an **accuracy circle**, which is honest about uncertainty
  (your earlier concern about misleading information). A "center on me"
  button. It stops watching when you leave the map. No distances and no
  routing; Directions still hands off to the maps app.

**3. Photos.**
- **Getting photos from the phone is easier on the web than you'd think.**
  - **No camera code.** A plain `<input type="file" accept="image/*"
    multiple>` makes the phone show its own menu:
    - on iOS, "Photo Library / Take Photo / Choose File";
    - on Android, the camera and gallery apps.
  - The operating system runs the camera and the gallery; we only receive
    the file(s).
  - **No permission prompt:** the user picking files *is* the permission.
  - `capture="environment"` would skip the menu and open the back camera
    directly. Useful as a second "Take photo" button, but optional.
  - The in-page camera (`getUserMedia`, a live viewfinder inside the app)
    is a different, harder thing. It needs a camera permission and our own
    shutter UI, and we don't need it.
- **Quality: the original is kept** (Julian, 2026-10-03: quality over
  storage, and 5–10 GB is fine).
  - The phone uploads the photo as picked. iPhone HEIC photos arrive as
    high-quality JPEG through the picker.
  - The **server** (Pillow, one photo at a time so the 512 MB machine copes)
    makes:
    - a **2560 px display copy**, JPEG quality ~85 (about 0.6–1 MB): what
      the journal shows full screen;
    - a **480 px thumbnail**.
  - Both copies are rotated correctly and have **their EXIF stripped**,
    including GPS.
  - The original keeps its EXIF. It's only ever downloaded deliberately
    ("Download original"), or loaded when zooming in.
  - About 3–6 MB per photo: 10 GB holds about 2,000 photos with their
    copies, roughly $1.50/month.
- **Storage: a Fly volume, agreed**, with a small `PhotoStore` interface (a
  local-disk version now) so moving to object storage later (Tigris on Fly,
  S3-compatible) is a swap, not a rewrite.
  - Files live under `/data/photos/<trip>/<photo id>/original.<ext>`,
    `display.jpg` and `thumb.jpg`.
  - A `photos` table holds the metadata: id, memory id, trip id, author,
    width, height, size, and when it was created and received. Soft delete.
- **Why not base64 in the database:**
  - it's about 33% bigger;
  - the SQLite file grows, and so does every backup and every copy;
  - photos would ride along in trip and journal JSON (memory, and the
    offline cache);
  - and there's no streaming or browser caching.

  Files on disk, metadata in the database, is the standard split.
- **Volume facts to plan around:**
  - The volume is attached to **one machine**. The app already runs a
    single machine, so that's fine. Scaling to two machines would mean
    moving to object storage (hence the interface).
  - Fly takes **daily snapshots, kept 5 days**, which cover the photos too.
  - Grow it from 1 GB to **~10 GB** with `fly volumes extend` before photos
    go live. That's about $0.15 per GB per month; Fly's snapshots may cost
    a little extra.
- **Serving:** an `<img>` tag can't send our login token (it's a header).
  So photos are served at **unguessable URLs**:
  - `GET /photos/{photo uuid}/{display|thumb|original}`, with no login
    check;
  - the random UUID is the secret, as with joining by trip id;
  - `Cache-Control: private, max-age=31536000, immutable`.

  Deleting the photo kills its URL. Signed short-lived URLs can be added
  later without touching storage.
- **Upload:** `POST /trips/{id}/memories/{memoryId}/photos` (multipart), by
  the memory's author.
  - Content type and size are checked (JPEG, PNG, WebP or HEIC, at most
    25 MB), and the image is re-decoded on the server with Pillow, so only
    real images get stored.
  - nginx's `client_max_body_size` (1 MB by default) goes up to 26 MB.
- **Offline:**
  - The **outbox holds the photo files too**, in IndexedDB. Uploads happen
    after the memory itself has synced. An installed app's storage isn't
    evicted.
  - **Thumbnails** of the journal are always cached for offline viewing,
    and display copies once viewed, up to a size cap (a service-worker
    runtime cache). Originals load only when online.
  - The outbox holds the original until it uploads, so an offline-queued
    photo takes its full size on the phone until then.
- **Viewing:** a strip of thumbnails on each memory. Tapping one opens it
  full screen, with swipe between photos.

### Phases

- **Phase 29 — memories made on the phone (API).** ✅
  - The client sends `id` and `createdAt`. `POST` with an existing id
    returns the same memory, so there are no duplicates.
  - `received_at` is added. A future time is clamped.
  - Edit and delete are unchanged.
  - **Tests:** a retry is idempotent, ordering follows the device time, the
    clamp, and another user's id gives 409.
- **Phase 29a — Alembic.** ✅ (Julian, 2026-10-03: "bring in Alembic; assume
  a deployed app after the rebuild work"; its own phase and commit.)
  - `api/alembic.ini` and `api/migrations/`, with an async `env.py` and batch
    mode for SQLite.
  - **0001 is the baseline:** the schema exactly as deployed from `rebuild`,
    autogenerated from those models.
  - **0002 adds `memories.received_at`** and backfills it from `created_at`
    (before Phase 29, that was the server's stamp).
  - `app/migrate.py` upgrades to head. A database from before Alembic is
    stamped at 0001 first, keeping its data.
  - `deploy/start.sh`, `api/dev.sh` and the seed run it. The app no longer
    calls `create_all`. The Dockerfile now copies the migrations.
  - **Fixed in passing:** `make reset-db` hardcoded `api/data/app.db`, so it
    never reset a worktree's database. It now deletes whichever file
    `DATABASE_URL` names.
  - **Tests:**
    - migrating to head gives exactly the models' schema (this catches
      model drift);
    - a pre-Alembic database is stamped, upgraded and keeps its data, with
      `received_at` backfilled;
    - migrating is idempotent, and a downgrade round-trips.
  - **Also checked by hand:** a database made by the real `rebuild` checkout
    (seeded, with a shared trip) migrated cleanly to 0002, with no schema
    differences.
- **Phase 30 — the outbox (UI).** ✅
  - **Built as planned, plus:**
    - **Every write goes through the outbox, online or not:** one path, and
      the screen updates instantly.
    - **A sync requested while another is finishing runs again right
      after.** A real bug, found by the tests: "back online" could otherwise
      be ignored until the 30-second retry.
    - **The offline bar no longer says "read-only":** memories can be
      written offline. Trip edits stay visibly greyed.
    - **Playwright reads this checkout's own ports from `.env`,** so
      worktrees can be tested live.
    - **Live:** `e2e/journal-offline.spec.js` writes two memories offline,
      goes back online, and checks they're sent once each, in order. The
      full `trip.spec.js` also passes on the worktree (13 tests).
  - The IndexedDB outbox, "Waiting to sync", sending on reconnect, on
    foreground, after saving and on back-off.
  - Offline edits and deletes, a 401 keeping the outbox, and the sign-out
    warning.
  - **Tests:** an outbox unit test with fake IndexedDB, plus component
    tests.
  - **Live:** Playwright offline, write two memories, go online, and check
    they sync once, in order.
- **Phase 31 — location and the blue dot.** ✅
  - **Built as planned, plus:**
    - **Migration 0003** adds `memories.lat`, `lng` and `accuracy`.
    - **An edit can drop a memory's location** (`location: null`) **but
      never add one**, since it records where the phone was at writing.
    - **The blue dot starts on its own only if location is already
      allowed;** otherwise "Show where I am" asks. Opening the map never
      pops a prompt.
    - **Fixed: pressed map toggles were invisible.** House, Calendar and the
      new Memories toggle all had `bg-card` overriding the pressed fill.
      House had this since Phase 15.
    - **Fixed: the journal e2e test's cleanup.** It counted before the
      journal loaded, then closed before the outbox sent the delete. That
      left test memories in the worktree's and the main dev databases;
      those were removed.
    - **Live:** `e2e/journal-location.spec.js`, with a faked location next
      to the Bern hotel: "Near Hotel Goldener Schlüssel", the memory's pin,
      and the blue dot.
  - The permission flow, a location chip in the dialog, and
    `lat`/`lng`/`accuracy` on memories (API and UI).
  - The nearest-trip-place label, and the map's blue dot with its accuracy
    circle and "center on me".
  - **Tests:** a mocked geolocation for granted, denied and slow, and a
    unit test for the nearest place.
  - **Live:** Playwright can fake a location (`geolocation` plus
    permissions).
- **Phase 32 — the photo store (API).** ✅
  - **Built as planned, plus:**
    - **`pillow` and `pillow-heif`** (iPhone HEIC), migration 0004, and
      `PHOTO_DIR` (`/data/photos` on Fly, in `fly.toml`).
    - **The display copy and thumbnail keep the colour profile** (Display
      P3), with EXIF stripped. Small photos are never upscaled.
      Transparent PNGs are put on white.
    - **"Decompression bombs" are refused** (over 120 megapixels).
    - **Processing is serialized,** one photo at a time.
    - **An upload can carry its own `id`,** for the Phase 33 outbox: a retry
      gives 200 with the same photo.
    - **Deleting a photo** removes its files and stops its URLs.
      **Deleting a memory** stops its photos' URLs but keeps the files
      (soft delete); purging them is a possible later job.
    - **Live:** a 9 MB, 12-megapixel JPEG processed in under a second on
      the Pi. The nginx `client_max_body_size` change passed `nginx -t`.
  - The `photos` table, `PhotoStore` on disk, and upload with its checks.
  - Server-made display copies and thumbnails (Pillow; rotation; EXIF
    stripped from the copies).
  - Unguessable URLs, delete, and the nginx body size.
  - **Tests:**
    - a real JPEG upload, then each size fetched;
    - the display copy is 2560 px on its long edge with no EXIF, and the
      original keeps its EXIF;
    - a non-image or an oversized file is rejected;
    - only the author can upload or delete, and only members can list
      photos;
    - a deleted photo's URLs give 404.
- **Phase 33 — photos in the journal (UI).** ✅
  - **Built as planned, plus:**
    - **Outbox entries for photos** ("addPhoto" and "removePhoto"), keyed by
      their own id and queued after their memory. Photo bytes are stored as
      an ArrayBuffer; a `FileReader` fallback covers older Safari.
    - **Deleting a memory drops its unsent photos.** Removing a photo that
      hasn't uploaded yet sends nothing.
    - **Photos are cached by the service worker:** thumbnails kept
      (cache-first), display copies capped at 200, originals never cached.
    - **Fixed, found by the parallel e2e run:** a race between the journal's
      refresh and the outbox could make a just-synced memory vanish until
      the next refresh. A regression test is confirmed to fail without the
      fix.
    - **Fixed:** an edit's server reply could briefly bring back a photo
      whose removal was still queued.
    - **Live:** `e2e/journal-photos.spec.js` picks two photos offline, they
      upload on reconnect (201 each), and the viewer shows the display copy
      and then the original. The whole live suite (15 tests) passed twice
      in a row.
  - **Julian, on a real phone over HTTPS:** take a photo with the camera and
    pick one from the library. Neither can be faked in a headless browser.
  - "Add photos" (the gallery or camera menu), the thumbnail strip,
    full-screen viewing on the display copy (zooming in loads the
    original), "Download original", the offline outbox for photos, and
    cached thumbnails and viewed display copies.
  - **Tests:** the picker flow, outbox photos, and which size each view
    asks for.
  - **Live:** upload a fixture photo in Playwright.
  - **Julian:** on a real phone over HTTPS, take a photo with the camera and
    pick one from the gallery.

### Open questions (Run stage 4)

- **Q-4.1. Your message was cut off** ("I don't have a…"). Was there more?
  - **Answer:** no, a typo (2026-10-03).
- **Q-4.2. The device's time orders the journal, and the server's
  `received_at` is kept as "created on"?** A device time more than 10
  minutes in the future is clamped rather than rejected.
  - Recommendation: yes.
  - **Answer:** yes (2026-10-03).
- **Q-4.3. Offline edits and deletes too, or only new memories?**
  - Recommendation: all three. With only the author editing, there's
    nothing to conflict with.
  - **Answer:** yes, all three (2026-10-03).
- **Q-4.4. Location on by default once allowed, with a chip to remove it
  per memory?**
  - Recommendation: yes. Ask the first time a memory is saved.
  - **Answer:** yes (2026-10-03).
- **Q-4.5. How is a memory's location shown?**
  - Recommendation: the nearest trip place within about 250 m, else a "Show
    on map" link. Google reverse geocoding later if wanted.
  - **Answer:** recommended: the nearest trip place within about 250 m, else a map link (2026-10-03).
- **Q-4.6. Show memories on the map too, as their own pins?** It's cheap
  once they have a location.
  - Recommendation: yes, in Phase 31, with a filter toggle beside
    House/Calendar.
  - **Answer:** yes, with a toggle (2026-10-03).
- **Q-4.7. Photo limits.**
  - Recommendation: up to 10 per memory; shrunk to 2048 px with a 480 px
    thumbnail; **originals not kept** (storage, and their EXIF location
    data).
  - **Answer:** **revised:** keep originals for quality, plus a server-made 2560 px display copy and a 480 px thumbnail; at most 10 per memory, about 25 MB each; a ~10 GB volume (2026-10-03).
- **Q-4.8. Photos offline.**
  - Recommendation: cache thumbnails only. Full-size photos when online.
  - **Answer:** thumbnails always, display copies once viewed (capped), originals online only (2026-10-03).
- **Q-4.9. Photos only on memories, or also on a stay or activity?**
  - Recommendation: memories only for now.
  - **Answer:** memories only (2026-10-03).
- **Q-4.10. Backups.** Are Fly's daily volume snapshots (kept 5 days)
  enough for now, or should there be an off-site copy, given that photos
  can't be recreated?
  - Recommendation: snapshots for now. An off-site copy (Tigris, or a
    nightly copy) before relying on it for a real trip.
  - **Answer:** snapshots for now; an off-site copy before a real trip (2026-10-03).

## Run stage 5 — Take photo, staying signed in, photos wait for Wi-Fi

Asked 2026-10-03 (Julian, after trying the deployed app on his phone):
- **"Add photos" opened the gallery, with no camera.** Recent Android goes
  straight to the gallery for `accept="image/*"`; only iOS offers "Take
  Photo" in that menu. Add a button that opens the camera.
- **Stay signed in** as long as the app is used within the 60-day window.
- **Photos wait on the phone until the user uploads them.** A web app can't
  tell Wi-Fi from cellular on iOS (only Chrome on Android can), and it
  can't run on a schedule in the background (no iOS background sync;
  Android's periodic sync can't be timed or relied on). So the user chooses
  when, by hand.

**Decisions** (answered 2026-10-03):
- **Manual upload only.** No "upload automatically" switch.
- **Photos taken in the app usually aren't in the camera roll** (iOS, and
  most Android, with `capture`). A photo waiting to upload gets a warning
  *and* a "Save to phone" button.
- **A simple sliding window for sign-in.** No server-side token list and
  no remote sign-out; changing `JWT_SECRET` still signs everyone out.

### Design

**1. Take photo.** A second button beside "Add photos": the same hidden
input pattern with `accept="image/*" capture="environment"` (one photo, no
`multiple`), feeding the same `photos.add`. The phone's camera app takes
the picture, so there's still no permission prompt and no viewfinder of
ours. "Add photos" stays for the gallery.

**2. Staying signed in.**
- **Today:** one 60-day JWT at login, never refreshed. Day 61 signs you out
  however often you used the app. (Unsynced writes survive: the outbox is
  keyed by user and sends after the next sign-in.)
- **`POST /auth/refresh`** (bearer token required, through
  `current_active_user`): returns a fresh 60-day token. It lives in
  `routers/auth_refresh.py`, beside fastapi-users' own `/auth/login`, and
  keeps its `{access_token, token_type}` shape.
- **The app refreshes quietly** when it starts or returns to the foreground,
  online only, and only if the token is more than a day old (`exp − 60
  days`, read from the token itself; no extra storage). A failed refresh is
  ignored: the token in hand still works until it expires.
- So any use within 60 days keeps you signed in indefinitely, and 60 days
  away means signing in again.

**3. Photos wait for an upload.**
- **Memory text still syncs straight away** (it's tiny). Only `addPhoto`
  outbox entries are held. `removePhoto` and deletes still sync, so
  removing a waiting photo still sends nothing.
- **`syncOutbox` skips `addPhoto`** unless asked: `uploadPhotos()` runs the
  same loop with photos included. The automatic triggers (start, reconnect,
  foreground, every 30 s) never send photos.
- **Waiting photos show on their memory** from their local bytes (the
  outbox already keeps them), marked "Waiting to upload".
- **The Journal shows one bar while anything waits:** "12 photos waiting
  (85 MB) · Upload", with progress ("Uploading 3 of 12"). An interrupted
  upload resumes on the next tap, and a photo already sent isn't sent again
  (photo ids make retries safe, Phase 32).
- **Save to phone**, on a waiting photo (and in the viewer): the share sheet
  with the file (`navigator.share({files})`, which offers "Save Image" on
  iOS), falling back to a download where file sharing isn't supported.
- **The warning** on the bar and in the memory dialog: "Photos taken here
  aren't in your camera roll until you save them. Not uploaded yet."
- **Keep the stash:** `navigator.storage.persist()` at startup (granted
  automatically for an installed app on most browsers; best effort).
- **Signing out** with photos waiting gets its own, stronger warning, on top
  of the existing unsynced-memories one.
- **Other people on the trip see a memory's photos only after the upload.**
  The memory itself appears straight away.

### Phases

- **Phase 34 — Take photo (UI).** ✅
  - **Built as planned.** Disabled at 10 photos, like "Add photos".
    Checked at 375px in a Playwright screenshot (both buttons fit on one
    line).
  - The "Take photo" button and its `capture="environment"` input.
  - **Tests:** the button's input has `capture="environment"` and no
    `multiple`; a picked file joins the previews like "Add photos".
  - **Julian, on a real phone over HTTPS:** Take photo opens the camera,
    and Add photos still opens the gallery.
- **Phase 35 — staying signed in.** ✅
  - **Built as planned, plus:**
    - **"Over a day old" is read from `exp`:** a token with less than 59
      days left. The app assumes the server's 60 days; if that's ever
      shorter, it just refreshes on each open, which is harmless.
    - **A `background` request option:** a failed refresh shows no toast
      (a 401 still signs out, as it should for an expired token).
    - **A refresh landing after a sign-out is ignored,** so it can't sign
      anyone back in.
    - **Live:** a real login against the dev API refreshes with 200; no
      token gets 401.
  - `POST /auth/refresh` and the quiet refresh in the app.
  - **Tests:**
    - API: a valid token gets a new one with a later `exp`; no token, an
      expired token or an inactive user gets 401.
    - UI: a token over a day old is refreshed on start and stored; a fresh
      one isn't; offline or a failed refresh leaves the old token in place.
- **Phase 36 — photos wait for an upload (UI).** ✅
  - **Built as planned, plus:**
    - **Two counts instead of one:** memory writes (they drive the 30 s
      retry and the sign-out warning) and waiting photos with their size.
      Counting held photos as "pending" would have retried every 30 s
      forever.
    - **Save to phone lives in the viewer** (tap a waiting thumbnail). The
      file is read ahead when the photo is shown, because iOS only opens
      the share sheet straight after a tap.
    - **The bar counts photos across all trips,** because Upload sends
      them all. It's disabled offline.
    - **Fixed, found by the parallel e2e run:** a memory whose photos were
      waiting could vanish from the journal on reconnect (the
      refresh/sync race from Phase 33: held photos made the memory look
      unsent). A regression test fails without the fix.
    - **Also fixed:** the sharing e2e test now looks for "Shared with you"
      on the sample trip only (the Athens demo trip is shared too).
    - **Live:** the updated `journal-photos.spec.js` passes; the full live
      suite passed 5 runs in a row.
  - Held `addPhoto` entries, the upload bar with progress, waiting
    thumbnails from local bytes, Save to phone, the warnings,
    `storage.persist()`.
  - **Tests:**
    - automatic sync sends memories but not photos; Upload sends the
      photos, oldest first, after their memory;
    - an interrupted upload resumes without duplicates;
    - the bar's count and size; a removed waiting photo sends nothing;
    - Save to phone shares the file, or downloads it without file sharing;
    - signing out with photos waiting warns.
  - **Live:** update `e2e/journal-photos.spec.js`: photos picked offline
    don't upload on reconnect; Upload sends them.
  - **Julian, on a real phone:** take a photo, check the warning, Save to
    phone, then upload on Wi-Fi.

## After Phase 4 — First real trip

Julian provides the itinerary. We convert it to a trip document, validate it
against the schema, and import it through the UI. Anything the format can't
express goes into the backlog rather than being forced in.

## Later / Backlog

- **Walk:**
  - Editing the trip header (name, dates, timezone). Activities are done;
    stays and travel are planned above.
  - Export a trip as a document.
- **Walk:** verification/gaps, rebuilt from `docs/lessons_learned.md`. Decide up
  front whether a screen answers "is it sound?" or "what's missing?". Stay and
  travel overlap checks belong here.
- **Run:**
  - Maps and Places lookup (the server resolves coordinates; never trust
    model-supplied coordinates).
  - "What's Next" active-trip mode (derive status from dates, never store it).
  - Share links → Run stage 3 (join codes and viewers).
  - Offline/PWA — planned as Run stage 1 (Phases 18–19).
- **Run, much later:** AI-assisted import (let the model do language, not data).
- Before any real deploy: Alembic and pinned Python dependencies.
- **Next follow-up (Julian, 2026-10-03):** a text-size preference that also
  scales the timeline rails and dots.
- Today tab: show it only while a trip is active (a switch on the whole
  view), once it has been tested.
