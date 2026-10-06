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

### Fix (2026-10-04): photo uploads killed for running out of memory on Fly

**Seen:** uploads failed intermittently. `fly logs` showed `Out of memory:
Killed process (gunicorn)` with the worker at about 290 MB, on a 512 MB
machine running nginx and **two** workers.

**Cause:** `photos.process` held several full-size decoded copies at once:
the decode, the rotate, the RGB convert, and a full copy before each
resize. A decoded photo is width x height x 3 bytes (72 MB at 24 MP, the
iPhone 15/16 default), so each upload's extra peak was about 191 MB at
12 MP, 344 MB at 24 MP and 639 MB at 48 MP. Two workers could also
process two photos at once, because the one-at-a-time lock is per process.

**Fix (Julian chose 1 and 2; 3 is held in reserve before the trip):**
1. **A leaner pipeline** (`photos._display`), with the same output:
   - JPEGs are decoded at 1/2, 1/4 or 1/8 scale where that still gives at
     least the display size (`draft`, asked for the fitted size such as
     2560 x 1920, not a 2560 box, which blocks non-square photos);
   - the image is shrunk in place, then turned upright, so the rotation
     copies a display-size image;
   - the thumbnail is made from the display copy;
   - no RGB convert when the photo is already RGB;
   - the reported width and height still come from the original (the
     file header, swapped for sideways orientations).
   - **Measured on the Pi** (fresh process each, sideways synthetic JPEGs):
     12 MP 191 → 98 MB, 24 MP 344 → 66 MB, 48 MP 639 → 97 MB.
2. **One gunicorn worker** (`deploy/start.sh`): one less baseline, and the
   photo lock now covers the whole server.
3. **Held in reserve:** 1 GB (`memory = "1gb"` under `[[vm]]` in
   `fly.toml`). Do it before the trip if any kill shows in `fly logs`. HEIC
   can't be decoded smaller, so it still decodes at full size.

**Tests:** a 24 MP sideways JPEG with a colour profile keeps its full upright
size, and its display copy and thumbnail are upright and keep the profile.
This guards the output; peak memory isn't unit-testable (Pillow allocates
outside Python), so the numbers above are the record.

## Run stage 6 — places in the seed data, map filters and pins, swiping days

Asked 2026-10-04 (Julian):
- Put the Google place data (`placeId`, `imgRef`) into `example-trip.json`
  and the seed data, using the existing backfill.
- **Map filters:** Journal shouldn't be on by default, and when it's on the
  map should show **only** memories.
- **Map pins:** clean, simple outline icons like the app's buttons, not
  emoji.
- **Days:** the previous/next links are duplicated at the top and bottom of
  the page. Replace them with a real swipe between days.

**Decisions** (answered 2026-10-04):
- Journal and Stays are **either-or** ("only memories" or "only stays").
  The Calendar filter still narrows either one to a single day.
- **Embla swipe only.** No sticky header; the prev/next links go.
- **Use an up-to-date Embla:** `embla-carousel-react` **8.6.0**, the latest
  stable release (2025-04). v9 has been in release candidates since
  2026-01 (rc03 on 2026-08-21) and isn't released, so not that. It supports
  React 18.

### Design

**1. Places in the trip files.** `make backfill-photos` runs against the dev
database, then each location's `placeId` and `imgRef` are copied back into
`example-trip.json`, `api/app/sample_data/sample_trip.json` and
`api/app/sample_data/demo_trip.py`. The JSON files are matched by document
position (with a name check), because one trip has the same name for two
places (TPE Terminal 2 with two place ids). The demo trip is matched by
name. The seed still plants only the sample and demo trips.

**2. Map filters** (`mapFilters.js`, `MapControls.jsx`, `MapPage.jsx`):
- One "what" filter: `null` (everything except memories), `"stays"` or
  `"memories"`. The default is `null`, so memories are hidden by default.
- Tapping Journal or the house toggles that filter; turning one on turns
  the other off.
- `filterMarkers(markers, { only, date })`. The date applies on top, as now
  (a stay matches any night it covers, and a memory matches the day it was
  made).

**3. Outline pins.** The pin stays a coloured `PinElement` (same colours per
kind). Its glyph becomes the same Lucide outline icon as the search rows
(`iconFor`: BedDouble, the travel mode icons, MapPin, NotebookPen), drawn in
white. It's rendered once per icon to an SVG data URL
(`renderToStaticMarkup`) and passed as `glyphSrc`. `glyphFor` and the emoji
go. If `glyphSrc` doesn't take an SVG data URL on the live map, we fall back
to passing the SVG element as `glyph`.

**4. Swiping between days** (`DayDetailPage.jsx`):
- An Embla carousel with one slide per day of the trip. Only the current day
  and its two neighbours render their timeline; the others are empty
  slides, so a 16-day trip doesn't render 16 timelines.
- The slide follows the finger, and releasing past halfway (or flicking)
  settles on the next day. Embla only takes horizontal drags, so vertical
  page scrolling is untouched.
- **The URL stays the source of truth.** Settling on a slide replaces the
  URL (`/trips/:id/days/:date`, `replace` so Back isn't a list of every day
  swiped). A URL change from elsewhere (the timeline, the Today tab, search)
  jumps the carousel with no animation.
- **Height:** each slide is only as tall as its own day (`align-items:
  flex-start` on the container), so a short day doesn't leave a long empty
  page. After settling, the page scrolls to the top.
- **Dialogs:** the edit dialogs are portals, but React still bubbles their
  events to the carousel, so Embla's `watchDrag` ignores drags that start
  outside the viewport. The current `useDaySwipe` guard does the same job
  today.
- Removed: `AdjacentDayLink` (top and bottom) and `useDaySwipe`.
- At the trip's ends there's nothing to swipe to: Embla's edge resistance
  shows that, with no loop.
- **Desktop:** Embla also drags with a mouse. The arrow keys move between
  days (a listener on the page, ignored while typing in a field or a dialog
  is open), since the visible links are gone.

### Phases

- **Phase 37 — places in the trip files and seed data.** ✅ (2026-10-04)
  - The backfill matched all 35 locations of the sample and demo trips (the
    Okinawa trip already had all of them).
  - The three documents still validate. Seeded locations have a `placeId`
    and `imgRef`.
  - **Julian:** spot-check the name-matched places that could be wrong:
    "Bern", "Wengen", "Syntagma" and "Athens Airport" are city/area names,
    matched by Places text search.
  - **Tests:** the API tests pass unchanged. Two UI tests had assumed the
    sample had no place ids (`buildMapMarkers`, and the day page's map
    link, which now carries `query_place_id`); they now expect the real
    ones. Nothing fetches the `imgRef` URLs in a test.
- **Phase 38 — map filters and outline pins (UI).** ✅ (2026-10-04)
  - **Built as planned, plus:**
    - The pin icons come from the vanilla **`lucide`** package (`^0.469.0`,
      the same version as lucide-react). lucide-react doesn't export its
      icon shapes, and `react-dom/server` would be a large extra download
      for a few icons. `glyphSrc` with an SVG data URL works on the live
      map (checked in Chromium at 375px).
    - The picked-Google-place pin's "+" is the outline `Plus` icon too.
    - The buttons are labelled "Show only memories" and "Show only stays".
  - **Tests:** `mapFilters.test.js`: the default hides memories; `"memories"`
    shows only memories; `"stays"` shows only stays; the date combines with
    each. `MapControls`: turning Journal on turns the house off and the
    reverse, and Journal starts unpressed. `mapStyle`: every kind and travel
    mode has an icon.
  - **Julian, at 375px:** the pins read clearly on the map.
- **Phase 39 — swipe between days (UI).** ✅ (2026-10-04)
  - **Built as planned, plus:**
    - ~~`embla-carousel-auto-height`~~ **Removed (fix, 2026-10-04):** it
      fixed the carousel's height on arrival, so expanding entries clipped
      the day and the page stopped scrolling (Julian spotted it). Now the
      carousel takes its natural height, and the off-screen neighbours are
      capped at one screen (`max-h-dvh`), so a long day next door can't add
      empty space. The swipe e2e opens every entry and checks the page
      scrolls to "Edit day" (screenshot `03c`).
    - The page scrolls inside `BottomNavLayout`, not the window, so its
      scroll container is marked `data-scroll-root`. A swipe scrolls that
      to the top once the new day settles.
    - Neighbouring days are `aria-hidden` and `inert`, so only the day in
      view can be read out or focused.
    - The edit dialogs are portals, so drags inside them never reach Embla;
      no extra guard is needed.
    - Tests use a small fake Embla (`src/test/fakeEmbla.js`, mocked for
      every test in `setup.js`); jsdom has no layout for the real one.
    - The Playwright test drags with the mouse, swipes with real touch
      events, checks a vertical drag doesn't change the day, and checks Back
      goes to the timeline (screenshots `03a`, `03b`).
  - **Tests:** with Embla mocked in jsdom (it measures layout, which jsdom
    doesn't have): the URL picks the slide; settling on a slide replaces the
    URL; only the current day and its neighbours render a timeline; the
    arrow keys change the day and are ignored in an input or a dialog; no
    prev/next links remain. A Playwright check drags the page sideways at
    375px and lands on the next day's URL.
  - **Julian, on a real phone:** swiping feels right, vertical scrolling
    never changes day, and dragging inside an edit dialog doesn't either.

### Open questions (Run stage 6)

None outstanding. The Embla version and the arrow keys are decided above;
say if either should change.

## Run stage 7 — more than one person editing a trip

Asked 2026-10-04 (Julian): let several people edit a trip. Conflicts on the
same entry are rare, but the "one trip document" model looked like it would
make them worse.

### Where we are

- **Writes are already per entry:** `PUT/DELETE /trips/{id}/items/{itemId}`
  (and `/move`), and the same for days, stays and travels. Only the
  **responses** are the whole trip. That stays: it gives the editor
  everyone else's changes after every save. So **no API breakdown is
  needed**.
- **Shared members are view-only:** `get_owned_trip` lets only the owner
  write (a member gets 403), and `TripMember.role` is always `"viewer"`.
- **Two people editing the same entry today:** the later save silently
  overwrites the earlier one (last write wins), with no warning.
- **Trip edits are online-only** (only memories go through the outbox), so
  there are no offline trip edits to reconcile.
- **Memories are per author** and already safe to retry (phone-made ids).
  They aren't part of this stage.

### The common approaches (simplest first)

1. **Last write wins.** What we have. Fine when conflicts are rare and
   cheap.
2. **Optimistic concurrency.** The standard for REST APIs. Each row has a
   `version`; the client says which version it edited (`If-Match`); a stale
   write gets **409** and the user picks theirs or mine. Nothing is lost
   silently.
3. **Field-level PATCH and merge.** Send only the fields that changed, so
   two people editing different fields of one entry both win. Builds on 2.
4. **Live updates** (SSE or WebSocket) push changes to the other phones, so
   screens are seconds stale, not minutes. Often with "PriPri is editing".
5. **A sync engine or CRDTs** (Yjs, Automerge, Replicache/Zero, PowerSync,
   ElectricSQL): offline-first, merged automatically. A rewrite of the data
   layer; overkill for two or three people planning a trip.

(Pessimistic locking, "PriPri has this checked out", is the other classic.
It's a poor fit for phones that drop offline: a lock can be stuck on a
phone in a tunnel.)

**Chosen:** 2, plus a cheap part of 4 (refetch when the app comes back to
the foreground). 3 and full live updates only if 409s turn out to be
annoying in practice.

**Decisions** (answered 2026-10-04):
- **A separate editor join code.** Joining with the viewer code makes you a
  viewer; joining with the editor code makes you an editor.
- **Editors can delete** stays, travels, days and activities. Only the
  trip itself stays owner-only.
- **A conflict is an error and a reload,** not a merge. No "theirs vs mine"
  dialog and no "Use mine". Your unsaved edit is dropped, and you redo it on
  the fresh copy if you still want it.
- **Trip editing stays online-only.** Nothing about trip edits is queued
  offline (only memories are), so there's nothing to reconcile later.
- **Show who last changed an entry** in its details ("Edited by PriPri, 2
  minutes ago"). Possibly hidden before the trip.

### Design

**1. An editor role.**
- `TripMember.role`: `"viewer"` or `"editor"`.
- **Two join codes per trip:** the existing one (viewer) and a new editor
  code (a new column on `trips`, generated the same way). `POST
  /trips/join` looks the code up in both and gives the matching role.
  Joining again with the other code changes your role to that code's.
- The share dialog shows both codes, labelled "Can view" and "Can edit".
  The owner can make a new editor code (the old one stops working; people
  who already joined keep their role) and remove members, as now.
- `get_owned_trip` becomes **`get_editable_trip`**: owner or editor, else
  403 for a viewer and 404 for anyone else. Every trip-child write already
  goes through it, so this is the one place. `ViewableTrip.role` gains
  `"editor"`, and the UI already shows edit controls by role.
- **Owner only, still:** deleting the trip, managing members and the join
  codes.
- Editors can add, change, move and delete days, activities, stays and
  travels (soft delete, as now).

**2. Versions (optimistic concurrency).**
- Stays, travels, days and items get `version` (int, starts at 1),
  `updated_at` (`UtcDateTime`) and `updated_by` (user id). One migration;
  existing rows get version 1 and `updated_at` = now.
- Every entry in `TripRead` carries its `version`, plus `updatedAt` and
  `updatedByName` for the conflict message.
- **`PUT` and `DELETE` on an entry need `If-Match: <version>`.** One helper
  in `services/` checks it and bumps the version, so each write calls it
  instead of checking by hand:
  - a match: the write goes ahead, and `version + 1`;
  - a mismatch: **409** with the entry's current state, its version, and
    who changed it and when;
  - no header: **428 Precondition Required**, so an old cached app can't
    silently overwrite. Its toast says to reload the app.
  - an entry deleted meanwhile: **404**, as now.
  - **Why a missing header is refused:** after a deploy, an installed app
    can run its old cached code until it's reopened. That code sends no
    version, so the server can't tell whether its save would overwrite
    someone. Refusing it means the old app shows its usual "couldn't save"
    error, and reopening the app fixes it. Nothing is overwritten.
- **Not versioned:** adding (nothing to conflict with; the server picks the
  position) and **moving up/down** (`/move` only swaps positions; it
  doesn't bump the content version, so reordering never blocks an edit).
  Moving an activity to another day is a content change (its `date`), so
  it is versioned.

**3. Conflicts in the UI.**
- The forms send the `version` they were opened with.
- **On 409:** the form closes, a warning says "PriPri changed this 4 minutes
  ago. Showing the latest.", and the trip reloads. Your edit is dropped.
- **On 404 while saving or deleting:** "This was removed by someone else",
  and the trip reloads.
- **On 428** (only an out-of-date app could get it, and the new app always
  sends a version): "The app has been updated. Close and reopen it."
- **Who changed it:** an entry's details show "Edited by PriPri, 2 minutes
  ago" (`updatedByName`, `updatedAt`). One component, so it's easy to hide
  later.
- **Fewer stale screens:** the trip is refetched when the app returns to the
  foreground (online). The same trigger already syncs the outbox.

### Phases

- **Phase 40 — editors (API + UI).** ✅ (2026-10-04)
  - **Built as planned. Details:**
    - **The view code is the trip's id** (as before), so viewers already
      know it. The edit code is a separate random secret
      (`trips.edit_code`, 20 URL-safe characters, migration 0005), made the
      first time the owner opens Share. `GET /trips/{id}/edit-code` reads
      it and `POST` renews it, both owner only.
    - **`POST /trips/join` takes `{code}`:** a trip id makes a viewer, an
      edit code an editor. `{tripId}` still works for older apps.
    - **`get_editable_trip`** (owner or editor) guards every trip-child
      write, through `get_editable_item/stay/travel`. **`get_owned_trip`**
      is now only for deleting the trip, the members list, removing members
      and the edit code.
    - **The Join dialog** takes either code ("Trip code"); the server tells
      them apart.
    - **The Share dialog** has two sections: "Can view" and "Can edit"
      (with a two-tap "New edit code"). Each member shows "Can edit" or
      "Can view". The trips list says "Shared with you · you can edit".
    - **E2E:** the seed admin joins with the edit code, gets edit controls,
      then leaves again (screenshot `21a`).
  - **Tests:** the editor code makes an editor and the viewer code a
    viewer; rejoining with the other code changes the role; a new editor
    code stops the old one working. An editor can add, change, move and
    delete each kind of entry, and can't delete the trip, see or renew the
    codes, or remove members (403). A viewer still gets 403 on writes; a
    stranger gets 404.
  - **Julian:** with two accounts, join with the editor code; the second
    phone shows edit controls.
- **Phase 41 — versions and 409 (API).** ✅ (2026-10-04)
  - **Built as planned, with these details and deviations:**
    - **`VersionedMixin`** (`version`, `updated_at`, `updated_by`) on
      stays, travels, days and items; the check and the stamp live in
      `services/versions.py`. The `if_match_version` dependency (in
      `dependencies.py`) reads the header before the body is validated.
    - **Deviation: `updated_by` has no foreign key.** On SQLite, adding a
      foreign key rebuilds the table, and rebuilding `days` or `stays`
      fails once activities point at them. The migration test only passed
      because its database was empty; a copy of the dev database failed.
      So 0006 is plain `ADD COLUMN`s, and the migration test now plants a
      day and an activity, so it would catch a rebuild.
    - **Existing rows keep `updated_at` null** (the plan said "now"): they
      were imported, never edited, so there's no one to name.
    - **A date with no day row is version 0**, so creating a day is
      versioned too. Making an activity on an untitled date creates the
      day at version 1.
    - **If-Match** takes `"3"`, `W/"3"` or `3`. A missing one is 428 (its
      message says to reopen the app); a malformed one is 400.
    - **The 409 body** is `{detail: {message, version, updatedAt,
      updatedByName, current}}`. `current` is the entry as the trip reads
      it now.
    - Every entry reads back with `version`, plus `updatedAt` and
      `updatedByName` once edited through the API (the user's name, else
      the first part of their email). Adding an entry stamps it too.
  - **Don't deploy Phase 41 without Phase 42:** the deployed app sends no
    version, so its edits would all get 428.
  - **Tests:** a matching `If-Match` saves and bumps the version; a stale
    one gives 409 with the current entry and who changed it; no header
    gives 428; an entry deleted meanwhile gives 404. `/move` doesn't change
    versions. The migration upgrades an existing database (versions 1).
- **Phase 42 — conflicts in the UI.** ✅ (2026-10-04)
  - **Built as planned. Details:**
    - Every change and delete thunk takes the entry's `version` and sends
      `If-Match`. Updating a day sends its row's version, or 0.
    - **`tripEdit` handles 409, 404 and 428 in one place.** 409/404: a
      warning toast ("PriPri changed this 2 minutes ago. Showing the
      latest." / "That was removed by someone else."), then `fetchTrip`, and
      the edit resolves to `{ reloaded: true }`, which closes the forms.
      428: an error toast, and the form stays open, saying to reopen the
      app.
    - **The API client's generic error toast skips statuses a request
      `handles`** (trip edits: 404, 409, 428). Without that, a 409 also
      showed "Request failed".
    - **"Edited by PriPri, 2 minutes ago"** is one small `EditedBy`
      component at the end of `EntryDetails` (`formatAgo` in `time.js`),
      easy to hide before the trip.
    - **`useTripRefresh`** (in App) reloads the open trip when the app
      returns to the foreground, online.
    - **E2E:** the owner and the seed admin (an editor) open the same
      dinner; the admin saves first, and the owner gets the warning and the
      admin's version (screenshot `24`). The test restores the dinner and
      leaves afterwards.
    - Fixed a Phase 38 miss: the `journal-location` e2e assumed memory pins
      show by default; it now turns on Journal (and matches only its own
      memory, so a failed run's leftovers can't break the next one).
  - **Tests:** a 409 closes the form, warns with the other person's name,
    and reloads the trip; a 404 warns and reloads; a 428 says to reopen the
    app; the details show who edited an entry and when; returning to the
    foreground refetches.
  - **Julian, on two phones:** both open the same activity, both save, and
    the second phone gets the warning and the first phone's change.

### Deferred: "theirs or mine" on a conflict

Not built now (Julian, 2026-10-04: a conflict is just an error and a
reload). If losing an edit on a conflict turns out to annoy, this is the
next step up, and the 409 already carries what it needs:
- **On 409, a dialog instead of a reload:** "PriPri changed this 4 minutes
  ago", with their version and yours side by side, field by field, and the
  differences marked.
- **Keep theirs:** drops your edit and reloads (what Phase 42 does anyway).
- **Use mine:** re-sends your edit with their version number in
  `If-Match`, so it deliberately overwrites theirs.
- A cheaper middle step: on a conflict, keep your typed text and reopen the
  form on the fresh copy, so you can re-apply it by hand.
- Further up: field-level merge (approach 3), so edits to different fields
  of one entry both win without asking.

### Open questions (Run stage 7)

All answered 2026-10-04 (see Decisions above):
1. How does someone become an editor? **A separate editor join code.**
2. Can editors delete stays and travels? **Yes.**
3. A save with no version? **Refused (428).** It only happens to an
   out-of-date installed app, for the minutes before it's reopened.
4. Show who last changed an entry? **Yes, in its details** (maybe hidden
   before the trip).

## Run stage 8 — export a trip

Asked 2026-10-05 (Julian): move trips between environments and keep JSON
backups. Not complicated: a `make` task that calls an endpoint with a trip id.
(This is the "Export a trip as a document" backlog item.)

### Where we are

- **The format already exists.** The trip document (`schema/trip.schema.json`)
  is what import takes, and `GET /trips/{id}` already returns that shape
  "plus ids and audit fields" (Architecture Decisions: *Read shape =
  document shape*). Export is that read with the extras taken off.
- **Why not just save `GET /trips/{id}`:** it adds `id`, `createdAt`, `role`,
  per-entry `version`/`updatedAt`/`updatedByName`, and the read-only `zone`
  fields. Import is `extra="forbid"`, so that payload would be refused. The
  export has to be a **clean document that imports as it is**.
- **Import always creates a brand-new trip** (lessons, rule 6), so a moved or
  restored trip gets a new id, and importing twice makes two trips. That's
  the intended behaviour for "move between environments".
- **Auth is a bearer token** from `POST /auth/login` (form fields
  `username` and `password`). Locally the API is at `http://localhost:<API_PORT>`;
  on Fly it's behind nginx at `https://<app>.fly.dev/api` (rewrite-and-strip).

### Architecture decisions (this stage)

- **`GET /trips/{id}/export`** returns the trip document, camelCase, absent
  fields omitted, with `Content-Disposition: attachment` and a filename like
  `okinawa-taipei-trip-fall-2026.json`. Same visibility as `GET /trips/{id}`
  (`get_viewable_trip`), and 404 for a missing or foreign trip.
- **Thin router, logic in `services/trips.py`.** `export_trip(db, trip_id)`
  reads through the same query as `get_trip`, then builds a `TripDocument`
  from it. **No second hand-written field list:** it is derived from the
  document models, so a field added to the format is exported automatically.
- **Order is kept.** Days by date, items/stays/travels by position (as the
  read already does).
- **Round trip is a test, not a hope:** import a document, export it, and the
  result equals the original (after validation); and the export is accepted by
  `validate_trip_document`.
- **The make task is a script, not improvised work** (AGENTS hard rule):
  `scripts/trip-client.sh`, called by `make export-trip`. It logs in, calls the
  endpoint and writes the file. Nothing is saved but the JSON.
- **Backups hold personal data** (confirmation numbers, ticket numbers), so
  the default output folder `exports/` is git-ignored.

### Phases

- **Phase 43 — the export endpoint (API).** ✅ (2026-10-05)
  - **Scope:** `GET /trips/{trip_id}/export`; `services/trips.export_trip`;
    filename slug; document the endpoint in OpenAPI (response is the
    `/schema/trip` document).
  - **Out of scope:** memories, photos, members and share codes; any UI;
    an import task.
  - **Tests:** the export imports cleanly (and passes the JSON Schema); an
    import → export round trip equals the original, including the sample trip
    and `example-trip.json`; no ids, versions, `role` or `zone` leak; soft-deleted
    stays/travels/days/items are not exported; a stranger gets 404 and a
    signed-out call 401; a joined viewer/editor can export (per question 2);
    the download headers are right.
- **Phase 44 — `make export-trip` (and docs).** ✅ (2026-10-05)
  - **Scope:** `scripts/trip-client.sh`; `make export-trip TRIP=<id>`
    with `API_URL`, `OUT`, and `TRIP_EMAIL`/`TRIP_PASSWORD`; `make list-trips`
    (id, name and dates, from `GET /trips`) using the same login code; a line
    each in `make help`; a short "Moving a trip between environments" section in
    `README.md`; `exports/` in `.gitignore`.
  - **Tests / verification:** the script fails with a clear message when
    `TRIP`, the credentials or the server are missing, or the login or the
    export is refused (and leaves no empty file behind); manual: export a
    trip locally, then import the file into the Fly app and compare.

### Open questions (Run stage 8)

1. **What does "the trip" include?**
   - The document format has **no memories, photos, members or share codes**.
     So an export is a backup of the *plan* (trip, stays, travels, days,
     activities), not the journal. Recommended: plan only, and say so in the
     README. Backing up journal entries and photos is a much bigger feature
     (a zip, new import).
   - **Answer:** Yes, plan only: a JSON dump of the plan.
   - **Resolved:** the export is the trip document and nothing else.
2. **Who may export?**
   - Options: the owner only, or anyone who can see the trip (owner, editor,
     viewer). Recommended: anyone who can see it, since they can already read
     every field; the edit code is not part of the export.
   - **Answer:** Anyone with view access or above. No front end at all:
     just the backend, called from a make task.
   - **Resolved:** `get_viewable_trip` guards the endpoint; there is no UI.
3. **How should the task sign in?**
   - Options: (a) `EMAIL=` and `PASSWORD=` on the command line or in the
     environment (simple; ends up in shell history); (b) the script prompts
     for the password (not scriptable); (c) `TOKEN=` a bearer token you got
     another way. Recommended: (a) with the environment variables
     `TRIP_EMAIL` / `TRIP_PASSWORD`, and a prompt only if the password is
     unset and a terminal is attached.
   - **Answer:** Yes: set the trip email and password in the environment.
   - **Resolved:** `TRIP_EMAIL` / `TRIP_PASSWORD`, prompting for the password
     only when it is unset and a terminal is attached.
4. **Which server by default, and where does the file go?**
   - Recommended: `API_URL` defaults to the local API
     (`http://localhost:<API_PORT>` from `api/.env`, like `make dev-api`);
     for Fly pass `API_URL=https://pripri-trip.fly.dev/api`. Output defaults to
     `exports/<trip-name-slug>.json` (git-ignored); `OUT=-` writes to stdout.
   - **Answer:** Yes.
   - **Resolved:** defaults as recommended.
5. **Do you also want `make import-trip` and a way to find trip ids?**
   - Import exists as an endpoint and in the UI, but moving a trip is easier
     with a matching `make import-trip FILE=… API_URL=…` (the same login
     handling, about 20 lines). A `make list-trips` that prints id and name
     saves digging the id out of the UI's address bar. Recommended: add both
     to Phase 44; they share the script's login code. Or keep it to export only.
   - **Answer:** `list-trips`, but not import.
   - **Resolved:** Phase 44 adds `make list-trips` beside `make export-trip`;
     `make import-trip` is not built (import stays the UI and endpoint).
6. **A button in the UI?**
   - Not asked for. Recommended: no, keep it a developer task for now; a
     "Download trip" item in the trip menu is a small follow-up if wanted.
   - **Answer:** Agreed.
   - **Resolved:** no UI in this stage.

## Run stage 9 — one look for an entry's details

Asked 2026-10-05 (Julian): the stays/travel details dialog (hero photo) and
the expanded rows show the same details in two looks. Keep one.

- **Already shared:** both render `EntryDetails` from `describeEntry`, so the
  content is one thing. Only the photo differed.
- **Decisions (answered 2026-10-05):** the hero sits at the top of the
  expanded panel, under the summary row (so the row doesn't jump on expand);
  activities get it too; flights and ferries use their airport/port photos,
  as the dialog did.

- **Phase 45 — one hero.** ✅ (2026-10-05)
  - `describeEntry().hero` is the one rule (a place's photo; a leg's
    destination, else origin). `HeroFade` + `useHeroImage` are the one
    component; `Dialog` and the expanded rows both use them. `PlaceRow`
    thumbnails and the `photos` flag are removed.
  - **Tests:** the hero rule for each kind of entry; an expanded row shows it
    (a flight too); it is dropped, with its padding, when the image fails;
    none without a photo; the dialog tests as before.
  - **Julian, on a phone:** open a day and expand a stay, a flight and an
    activity: the fade, the text over it, and no jump in the header. Photos
    need the network, so offline shows the plain row.

## Run stage 10 — public memories, photo backup to the Pi, weather, currency, countdown

Asked 2026-10-05 (Julian), five features:
- **Photo backup to the Pi.** The Raspberry Pi on the home network is always
  on (Tailscale later, for remote access). Every ~30 minutes a job checks for
  newly uploaded photos, downloads them and saves them to a 512 GB thumb drive.
- **Public and private memories.** The in-laws will join as **viewers** to
  follow the itinerary. Viewers see the plan, the map and **public** journal
  entries only. Every memory is **private by default**. Julian and PriPri are
  both **editors** (owner + editor), see every memory, and can mark an entry
  public. (Instead of texting 20 photos a day.)
- **Weather.** A weather endpoint for the trip's **places** (not the phone's),
  for every day of the trip, as far ahead as the API allows, plus today's
  weather. Cached on the server; a request reads the cache and refreshes
  anything more than 12 hours old. OpenWeatherMap, key in `api/.env` and as a
  Fly secret. Works before the trip starts.
- **Currency.** A converter: the rate from USD to the trip's currency, and a
  calculator (local amount in, USD out). Frankfurter. Rates cached on the
  device so a calculation never re-requests.
- **Weather and Currency are their own pages**, reached from the ☰ drawer, not
  added to the tab bar or the trip screens.
- **Countdown** on the All trips screen for an upcoming trip: to midnight at
  the start of its first day, against the phone's clock. One unit at a time:
  days while more than 24 hours remain, then hours, then minutes.

**Decisions (answered 2026-10-05):** every recommendation below, and the
backup drive is ext4 on a Raspberry Pi 5 (Q-B5).

**Order (Q-O1):** public memories first (it must land before the in-laws
are invited, because today every viewer sees every memory), then the backup
(before the trip), weather, currency, and the countdown. Each is independent,
so the order can change.

### Where we are

- **Roles:** owner (`trips.user_id`), and `TripMember.role` `"editor"` or
  `"viewer"`. `get_viewable_trip` lets in all three, `get_editable_trip`
  owner or editor. **Every member can read and write memories today**
  (`selectCanWriteMemory`), and `GET /trips/{id}/memories` returns all of
  them. So a viewer sees every memory and its photos.
- **The viewer code is the trip's id**, which is in every trip URL. A viewer
  also sees everything on the plan, including confirmation numbers (Q-S4,
  answered when the only viewer was a traveler).
- **Photos** are files under `PHOTO_DIR` (`/data/photos` on the Fly volume),
  with a `photos` row each, served at `GET /photos/{id}/{variant}` with no login
  check (the random id is the secret). There is no way to list photos except
  through a trip's memories, and no off-site copy: only Fly's 5-day snapshots
  (Run stage 4 said an off-site copy comes "before relying on it for a real
  trip").
- **The Fly machine** auto-stops when idle but keeps `min_machines_running =
  1`, and runs one gunicorn worker.
- **Places** carry `lat`/`lng` and a `city`; every entry's zone is computed
  from its coordinates (`zones.py`, tzfpy). There is no country or currency
  field.
- **Checked today (2026-10-05):**
  - Frankfurter v2 needs no key, sends `Access-Control-Allow-Origin: *`, and
    covers both of this trip's currencies (`/v2/rates?base=USD&quotes=JPY,TWD`
    gave JPY 157.93, TWD 31.821).
  - OpenWeatherMap's One Call 3.0 answers 401 unless the key has the "One Call
    by Call" subscription (tested with a dummy key, so this only shows the
    endpoint's rule, not Julian's key).
- **The backup Pi is a Raspberry Pi 5** with a drive dedicated to the backup
  (Q-B5). The install script doesn't assume it's this checkout's machine.

### Design: public and private memories

- **`memories.is_public`**, a boolean, default `false` (migration 0007).
  Existing memories become private. The phone sends it with the memory, so
  it goes through the outbox like any other edit and works offline.
- **Who sees what, in one place.** `services/memories.list_memories` filters
  by the caller's role:
  - owner and editors: every memory;
  - viewers: public memories only (and their own, if any exist from before).
  The same filter guards `GET` of a single memory, the memories in the
  offline cache, the map's memory pins and the photos listed on a memory, so
  a viewer is never handed a private photo's id. A private memory reads as
  **404** to a viewer, like a foreign row.
- **Viewers no longer write memories** (Q-P2): `POST` gives 403 for a viewer,
  `selectCanWriteMemory` becomes "online-or-outbox and owner or editor", and
  New memory is hidden for viewers. Their Journal tab is a read-only feed of
  public entries, with an empty state ("Nothing shared yet").
- **Who marks it public** (Q-P1): the author, in the memory dialog: a
  "Visible to viewers" switch, off by default. Public memories get a small
  "Public" badge for editors so it's clear what the in-laws can see. Any
  editor's view shows the badge; only the author flips it.
- **Booking details for viewers** (Q-P3): `confirmationNumber` is removed from
  stays, travels and activities in `TripRead` for viewers, server-side (in
  the read model, so the offline cache never holds it either). Notes stay.
  Export, which viewers can call, strips it too.
- **A revocable view code** (Q-P4): `trips.view_code`, a random secret made and
  renewed like `edit_code` (same generator, same Share dialog row). Joining
  with the trip id keeps working only for people who already joined; new
  viewers need the code. "New view code" stops the old one; people already on
  the trip stay.
- **Accepted limitation:** making a public memory private again hides it from
  then on, but a viewer's phone may still hold the thumbnails it cached, and a
  photo URL someone saved keeps working (it's unguessable, not signed). Fine
  for "they already saw it". Signed photo URLs remain the upgrade path.

### Design: photo backup to the Pi

- **An admin manifest:** `GET /admin/backup/photos?after=<cursor>` (superuser,
  under the existing `/admin` router, so it's protected by construction).
  Every live photo across all trips, oldest `received_at` first, 500 per page,
  each with: photo id, trip id and name, memory id, author name, the memory's
  local time and zone, original format and bytes, and the original's URL. The
  cursor is `(received_at, id)`, so a page can't skip a photo uploaded mid-run.
- **A journal dump:** `GET /admin/backup/journal/{trip_id}`: the trip's
  memories (text, times, zone, place, public flag, author, photo ids) as JSON
  (Q-B2). The trip export (Run stage 8) is plan-only, so this is the only copy
  of the journal's words outside Fly.
- **The Pi script:** `scripts/pi-backup/pripri_backup.py`, Python 3 standard
  library only (nothing to `pip install` on the Pi).
  1. **Refuses to run unless the drive is mounted** (`os.path.ismount`).
     Otherwise it would quietly fill the SD card.
  2. Signs in (`POST /auth/login`), reading `API_URL`, `BACKUP_EMAIL` and
     `BACKUP_PASSWORD` from `/etc/pripri-backup.env` (mode 600).
  3. Pages through the manifest from the cursor saved last time
     (`state.json` on the drive, so the drive knows what it holds).
  4. Downloads each original to `<name>.part`, checks the byte count, then
     renames: a crash never leaves a half photo with a real name. A file that
     already exists with the right size is skipped, so a lost state file only
     costs a re-scan, not a re-download.
  5. Rewrites each trip's `journal.json` when any of its photos changed (and
     at least daily).
  6. Logs a one-line summary ("3 new photos, 41 MB").
- **Layout on the drive** (`/mnt/pripri-backup/PriPriTrip/`):
  `<trip-name-slug>/<YYYY-MM-DD>/<HHMM>_<author>_<photo-id-8>.<ext>`, dated by
  the memory's local time where it was written, plus
  `<trip-name-slug>/journal.json`. Browsable from any computer.
- **Never deletes** from the drive (Q-B3): a photo deleted in the app stays in
  the backup. It's a backup, not a mirror.
- **Scheduling: a systemd timer**, not cron: `OnCalendar=*:0/30`,
  `Persistent=true` (a run missed while the Pi was off happens at boot), and
  logs in `journalctl -u pripri-backup`. `scripts/pi-backup/install.sh`
  installs the unit files and the env file template; `make pi-backup-install`
  calls it (a script, not hand setup, per AGENTS.md). The drive is formatted
  **ext4** (dedicated to the backup, never leaves the Pi; Q-B5), mounted by
  UUID in `/etc/fstab` with `nofail`, so the Pi still boots without it.
- **Network:** the Pi pulls from `https://pripri-trip.fly.dev/api`; nothing
  connects to the Pi, so Tailscale isn't needed for the backup (only for
  reaching the Pi yourself).
- **Known gap:** photos still waiting on a phone (not uploaded, Run stage 5)
  aren't on the server, so they aren't backed up until uploaded.

### Design: weather

- **Source: OpenWeatherMap One Call 3.0** (Q-W1), one key, server side only:
  - `/data/3.0/onecall` per place: **current** conditions, **8 days** of daily
    forecast and **alerts** (late October is still typhoon season in Okinawa);
  - `/data/3.0/onecall/day_summary` per trip day beyond the 8 days: OWM's
    daily aggregate, which reaches up to 1.5 years ahead, so every trip day
    shows something weeks before the trip. Labelled **"Long-range outlook"**,
    never as a forecast.
  - Phase 50 starts with a spike against Julian's real key to confirm both
    endpoints and what `day_summary` returns for a future date before building
    on it.
- **Which place is a day's weather** (Q-W2): where you sleep that night (the
  stay covering it); on a travel day with no stay, the arrival place of the
  day's last leg; otherwise the previous day's place. One place per day,
  shown with its `city`. Places are rounded to 2 decimal places (~1 km) so
  nearby days share one lookup. The rule is one pure function
  (`services/weather.day_places`), tested on its own.
- **Today** (Q-W3): during the trip, current conditions at today's place;
  before it, at the first day's place ("Naha right now"); after it, none.
- **Data points per day:** condition and icon, high and low, feels-like
  (day), chance and amount of rain, humidity, wind and gusts, UV index,
  sunrise and sunset. Current: temperature, feels-like, condition, humidity,
  wind, UV. The long-range outlook has fewer (high, low, rain amount,
  humidity, cloud, wind).
- **Units** (Q-W4): stored metric (OWM's `units=metric`); the page shows °F
  and mph with °C beside the high/low. Converting on display means a units
  change never needs a refetch.
- **The cache:** a `weather_cache` table: `key` (unique, e.g.
  `onecall:26.22,127.69` or `day:26.22,127.69:2026-11-02`), `payload` (JSON as
  OWM sent it), `fetched_at` (`UtcDateTime`). It's a cache of public data keyed
  by place, so it's **not user-owned and not soft-deleted** (rows are
  upserted); this is a deliberate exception to the domain-row conventions, as
  no user's data is in it.
- **`GET /trips/{id}/weather`** (`get_viewable_trip`, so viewers get it too):
  1. works out each day's place;
  2. reads the cache; anything older than 12 hours is refreshed from OWM, in
     parallel (`httpx`, 10 s timeout), one refresh per key at a time (a lock),
     so two phones opening the page don't double the calls;
  3. a failed refresh serves the stale entry, marked with when it's from;
     nothing cached and no answer means that day says "Unavailable";
  4. returns `{ today, days: [{ date, place, kind: "forecast" | "outlook" |
     "none", fetchedAt, ... }], alerts }`, normalised (the page never sees
     OWM's raw shape).
  - Past days return `none` (no historical lookups).
  - No key set: 503 "Weather isn't set up", and the page says so.
- **No scheduled job** (Q-W5): refreshing on request does what "once a day"
  would, and calls OWM only when someone looks. Budget: about (places + days
  beyond 8) calls per 12 hours, roughly 25 for this trip, against the free
  1,000 a day.
- **Key setup:** `OPENWEATHER_API_KEY` in `api/.env` (and `.env.example`), and
  `fly secrets set OPENWEATHER_API_KEY=…`. Never sent to the browser.
- **Offline:** the last weather response is cached with the trip, so the page
  shows it offline with "Updated 5 hours ago".

### Design: currency

- **No backend** (Q-C1). The browser calls Frankfurter directly (no key, CORS
  open). Server caching would add a table and an endpoint for nothing: the
  rates are public, and the phone has to cache them anyway to work offline.
- **Device cache:** `GET /v2/rates?base=USD&quotes=<the trip's currencies>`,
  stored with its fetch time (localStorage, wrapped in try/catch). Reused for
  12 hours; every calculation uses the stored rate. A failed or offline fetch
  uses the stored one with "Rate from Oct 5". Never fetched → "Connect once to
  get today's rate".
- **Which currencies** (Q-C2): from the trip's places. Each entry already reads
  with its computed `zone`; a pure `tripCurrencies(trip)` maps zone → country
  (tzdata's `zone.tab`) → currency (a small table), in place order. The
  lookup table is generated once by `scripts/gen-zone-currency.py` and
  committed as `ui/src/features/tools/zoneCurrency.js`. Okinawa & Taipei →
  JPY, TWD. Chips switch between them, defaulting to today's place during the
  trip; "Other…" picks any Frankfurter currency (remembered per trip on the
  device).
- **The page:** "1 USD = 157.93 JPY" (and the inverse, "¥100 = $0.63"), the
  rate's date, and a calculator: a large numeric input in the local currency,
  the USD result live below it. A swap button turns it USD → local (Q-C3).
  Labelled a **reference rate**: cards and ATMs add their own margin.

### Design: the pages and the drawer

- Routes: `/trips/:tripId/weather` and `/trips/:tripId/currency`, each a plain
  page with the top bar and a back arrow (no bottom tabs).
- The ☰ drawer gets **Weather** and **Currency** under a "Trip tools" heading,
  shown only while a trip is open (Q-N1). Nothing else changes on the trip
  screens.
- Follows `design_doc.md`: loading skeletons, the empty and error states, and
  toasts only for actions.

### Design: countdown

- **On upcoming trip cards** on All trips: "24 days to go", then "5 hours to
  go", then "12 minutes to go", then "Starting now" under a minute.
- **The target** (Q-D1): midnight at the start of `startDate` on the
  **phone's** clock (the local midnight of that date, wherever the phone is).
  For Okinawa: 12:00 AM Oct 29 in Chicago, half an hour before the 12:30 AM
  flight.
- **Units** (Q-D2): whole units rounded down (2 days 23 hours reads "2
  days"); "1 day"/"1 hour" singular. One pure function
  (`countdownLabel(startDate, now)`), tested at each boundary (exactly 24 h,
  23 h 59 m, 60 m, 59 m, 0, and across a daylight-saving change).
- It re-renders every 30 seconds while the page is open (one timer for the
  list, not one per card). Once the start passes, the trip moves to the
  current group as today, and the countdown disappears.

### Phases

- **Phase 46 — public memories (API).** ✅ (2026-10-05)
  - **Scope:** migration 0007 (`memories.is_public`, `trips.view_code`);
    `is_public` on create/update and in `MemoryRead`; the viewer filter in
    `services/memories`; viewers can't create (403); `confirmationNumber`
    stripped for viewers in `TripRead` and export; the view code (make, renew,
    join with it; trip id still works for existing members only).
  - **Tests:** a viewer lists only public memories, gets 404 for a private
    one, never sees a private memory's photo ids; owner and editor see all;
    the author flips `isPublic`, another editor can't (403); a viewer can't
    create; a viewer's trip and export have no confirmation numbers, an
    editor's do; join with the view code makes a viewer, an old code fails
    after renewing, the trip id no longer joins a new user; the migration
    upgrades a copy of a database with memories (all private).
- **Phase 47 — public memories (UI).** ✅ (2026-10-05)
  - **Scope:** the "Visible to viewers" switch (outbox-aware), the Public
    badge, viewers' read-only Journal with its empty state, New memory hidden
    for viewers, the Share dialog's view code with "New view code".
  - **Tests:** viewers see no New memory and no switch; the switch's value
    reaches the outbox entry; the badge shows for public memories; the Share
    dialog renews the view code.
  - **Julian, at 375px:** as an editor, mark one memory public; as the seed
    viewer, see only that one, with its photos.
- **Phase 48 — backup manifest (API).** ✅ (2026-10-05)
  - **Scope:** `GET /admin/backup/photos` (cursor pages) and
    `GET /admin/backup/journal/{trip_id}`.
  - **Tests:** superuser only (401/403 otherwise); cursor order is stable and
    complete across pages, including a photo added between pages; deleted
    photos are left out; the journal dump has every live memory, public or
    not.
- **Phase 49 — the Pi job.** ✅ (2026-10-05; install on the Pi pending)
  - **Scope:** `scripts/pi-backup/` (script, systemd service and timer,
    install script, env template), `make pi-backup-install`, a README section
    (formatting and mounting the drive by UUID, the env file, checking
    `journalctl`).
  - **Tests:** pytest for the script against a fake server: refuses when the
    drive isn't mounted; resumes from the cursor; a `.part` file never becomes
    a photo when the size is wrong; skips files already there; deleted
    photos stay on disk.
  - **Julian:** install on the Pi, upload a photo from the phone, and see it on
    the drive within 30 minutes.
- **Phase 50 — weather (API).** ✅ (2026-10-05; live check pending a key)
  - **Scope:** the spike against the real key (results noted here first, and
    raised if the long-range data isn't what's described); `weather_cache`
    (migration 0008); `services/weather.py` (day places, refresh, normalise);
    `GET /trips/{id}/weather`; `OPENWEATHER_API_KEY`.
  - **Tests (OWM mocked):** day places for stays, travel days and gaps; a fresh
    cache makes no call, a 13-hour-old one refreshes; a failed refresh serves
    stale data; two concurrent requests make one call per key; days past the
    8-day window use the outlook; past days are `none`; no key is 503;
    viewers can read it, strangers get 404.
- **Phase 51 — weather (UI).** ✅ (2026-10-05)
  - **Scope:** the drawer's Trip tools, the Weather page (today, alerts, the
    day list with forecast/outlook/unavailable states), offline caching.
  - **Tests:** each day state renders; °F/mph with °C; alerts show; the drawer
    shows Trip tools only in a trip; offline shows the cached copy with its
    age.
  - **Julian, at 375px:** the Okinawa trip's weather page.
- **Phase 52 — currency (UI).** ✅ (2026-10-05)
  - **Scope:** the zone → currency table and its generator, `tripCurrencies`,
    the rate cache, the Currency page and calculator.
  - **Tests:** JPY and TWD for the Okinawa trip; a cached rate within 12 hours
    makes no request, an older one refetches, a failed fetch uses the cached
    one with its date; the calculator's maths and rounding (USD to the cent; JPY and
    TWD to whole units); swap.
- **Phase 53 — countdown (UI).** ✅ (2026-10-05)
  - **Scope:** `countdownLabel`, the label on upcoming cards, the shared timer.
  - **Tests:** every boundary listed above; only upcoming trips get it.

### Built (2026-10-05): Phases 46–53

Julian answered the questions with "your recommendations" and asked for all
phases to be built in one go, with the app never failing for want of a
weather key. One commit per phase, each with `make verify` green (final: 218
API + 330 UI tests). The e2e suite (22 specs, 375 px) passes live; new
screenshots `24-journal-viewer`, `25-memory-public-switch`, `30`–`34` (trips
countdown, drawer, weather, currency).

**As planned, with these details and deviations:**
- **Public memories (46–47).** `memories.is_public` and `trips.view_code`
  (migration 0007, plain `ADD COLUMN`s). The viewer rule lives in
  `services/memories.visible_to`. A viewer sees public memories plus any
  they wrote themselves before this change. `get_journal_trip` stops
  viewers from writing (403). `get_own_memory` returns 404 when a viewer
  touches someone else's private memory.
  - **Joining by trip id:** it now works only for someone already on the
    trip, and changes nothing (no switching to viewer). New people need the
    view or edit code.
  - **Fixed along the way:** the outbox's send step picked fields one by
    one, so it would have dropped `isPublic`.
- **Backup (48–49).** Deviation: one `GET /admin/backup/journals` returns
  every trip's journal, rather than one call per trip, so the Pi doesn't
  need a trip list. Photos are ordered by upload time (`photos.created_at`
  is the server's stamp; photos have no `received_at`).
  - Added `python -m app.make_admin <email>`, because the Fly image has no
    `sqlite3` command to make the backup account a superuser.
  - The Pi script's tests (`api/tests/test_pi_backup.py`) run against a fake
    server, and `make lint` covers `scripts/pi-backup/`.
- **Weather (50–51).**
  - **The spike didn't run:** there's no `OPENWEATHER_API_KEY` locally. The
    code follows OWM's documented One Call 3.0 and `day_summary` shapes and
    is tested against a fake. **First thing with a real key:** open the
    weather page for the Okinawa trip. Check that days more than 8 days out
    show an outlook (not "No forecast yet"), and that the forecast days line
    up with the right dates.
  - Deviation: with no key, the endpoint answers **200
    `{configured: false}`** rather than 503, so nothing raises an error toast
    and nothing can fail. A rejected key, a used-up daily limit or a network
    failure comes back as `problem`, with stale or "unavailable" days, still
    200.
  - The response carries each place's `zone`, so sunrise and sunset show in
    local time. Icons are lucide icons rather than OWM's images, so they work
    offline.
- **Currency (52).**
  - The files live in `features/currency/` (the plan said `features/tools/`),
    following the one-slice-per-feature rule.
  - Amounts are formatted as US English on purpose ("¥", "NT$", "$"). A
    phone set to another locale could otherwise show "US$", or a bare "$"
    for NT$.
  - TWD shows cents, as `Intl` does by default.
- **Countdown (53).** The countdown shows on any card whose first day hasn't
  begun on the phone's clock. For the first ~14 hours after midnight in
  Tokyo, that includes a trip already listed under "Active", which goes by
  the trip's own zone.

**Before relying on it (Julian):**
- **Deploy 46–53 together.** The old app's Share dialog shows the trip id as
  the view code, and the trip id no longer lets new people join. Fly runs
  migrations 0007 and 0008 on start.
- **If PriPri joined the real trip as a viewer,** they need to rejoin with
  the **edit code** to see private memories and write new ones. All
  existing memories are now private.
- `fly secrets set OPENWEATHER_API_KEY=…`, with the One Call by Call
  subscription and a 1,000-a-day cap.
- The Pi: format and mount the drive, `make pi-backup-install`, fill in
  `/etc/pripri-backup.env`, `make pi-backup-run` (README, "Photo backup to
  the Pi").
- At 375 px: the Share dialog's two codes, a public memory as the seed
  viewer, the Weather and Currency pages from the drawer.

### Open questions (Run stage 10)

Public and private memories:

- **Q-P1. Who can make a memory public?**
  - (a) Only its author (today only the author edits a memory).
  - (b) Any editor, so either of you can share the other's entry.
  - Recommendation: **(a)**. It keeps "only the author changes a memory", and
    nobody's private note gets shared by someone else.
  - **Answer:** as recommended (2026-10-05).
- **Q-P2. Can viewers still write memories?** Today every member can.
  - (a) No: viewers get a read-only feed of public entries.
  - (b) Yes, and theirs are always visible to everyone.
  - Recommendation: **(a)**. The journal is yours; the in-laws follow along.
  - **Answer:** as recommended (2026-10-05).
- **Q-P3. Should viewers see confirmation numbers?** Q-S4 said yes when the
  only viewer was a traveler. With in-laws, those numbers (and a forwarded
  link) are enough to change a booking.
  - Recommendation: **hide them from viewers**, server-side. Notes, times and
    places stay. You two are editors, so you still see everything.
  - **Answer:** as recommended (2026-10-05).
- **Q-P4. The viewer code is the trip id,** which is in every trip URL. Anyone
  who sees a link or screenshot can join and read the plan, and it can't be
  revoked (only each person removed).
  - (a) Keep it; remove strangers from the Share dialog if they appear.
  - (b) A random view code, renewable like the edit code. People already on
    the trip stay.
  - Recommendation: **(b)** now that it's shared beyond the two of you. It
    reuses the edit code's machinery, so it's small.
  - **Answer:** as recommended (2026-10-05).

Photo backup:

- **Q-B1. How does the Pi sign in?**
  - (a) A superuser account (the backup endpoints live under `/admin`, per the
    template's convention). Its password sits in a root-only file on the Pi.
  - (b) A separate backup token (a Fly secret) that only opens the backup
    endpoints, so the Pi never holds an account password.
  - Recommendation: **(a)**, with a dedicated superuser account for the Pi
    (e.g. `backup@…`) so it can be disabled without touching yours. (b) is
    tighter but adds a second auth path to maintain.
  - **Answer:** as recommended (2026-10-05).
- **Q-B2. What gets backed up?**
  - (a) Photo originals only.
  - (b) Originals plus each trip's `journal.json` (memory text, times,
    places, which photos belong to which memory).
  - Recommendation: **(b)**. The trip export is plan-only, so this is the only
    off-Fly copy of what you wrote. It's a few hundred KB.
  - **Answer:** as recommended (2026-10-05).
- **Q-B3. A photo deleted in the app:** keep it on the drive (recommended: a
  backup, not a mirror) or delete it there too?
  - **Answer:** as recommended (2026-10-05).
- **Q-B4. The folder layout:** `<trip>/<date>/<time>_<author>_<id>.jpg`
  (recommended, browsable by day) or one flat folder per trip?
  - **Answer:** as recommended (2026-10-05).
- **Q-B5. The drive and the Pi.**
  - Is this machine (a Pi 5, where this session runs) the backup Pi?
  - How is the drive formatted? (a) **exFAT**: plug it into any Mac or PC to
    look through the photos; (b) **ext4**: Linux-native, sturdier on power
    loss, but a Mac/PC can't read it without extra software.
  - Recommendation: keep **exFAT** if that's what it is (likely, out of the
    box) so you can plug it in anywhere; ext4 only if it never leaves the Pi.
  - **Answer:** a Raspberry Pi 5; the drive is dedicated to the backup and can
    be formatted as needed (2026-10-05). **Resolved:** **ext4** (it never
    leaves the Pi). The install script works on any Pi, this one or another.

Weather:

- **Q-W1. Which OpenWeatherMap plan?**
  - (a) **One Call 3.0** ("One Call by Call"): needs a card on file, the first
    1,000 calls a day are free, and you can set a daily cap of 1,000 in OWM's
    dashboard so it can never charge. Gives current, 8 days daily, alerts, and
    the long-range daily outlook, so every trip day shows something weeks
    ahead.
  - (b) **The free key only:** current weather and 5 days of forecast (in
    3-hour steps). Trip days more than 5 days out show "Forecast from <date>".
    Before the trip, nothing for its days until 5 days before.
  - Recommendation: **(a)**, with the 1,000 cap. "As many days as possible" and
    "works ahead of the trip" both need it. We'd use about 25 calls a day.
  - **Answer:** as recommended (2026-10-05).
- **Q-W2. Which place is a day's weather?**
  - (a) One per day: where you sleep that night, else the travel day's
    arrival, else the previous day's.
  - (b) Every place with coordinates on the day.
  - Recommendation: **(a)**. Your places on one island are a few km apart;
    the overnight place is what matters, and it's one line per day.
  - **Answer:** as recommended (2026-10-05).
- **Q-W3. "Today's weather" before and after the trip?**
  - Recommendation: before, current conditions at the trip's first place
    ("Naha right now"); during, today's place; after, not shown.
  - **Answer:** as recommended (2026-10-05).
- **Q-W4. Units?**
  - Recommendation: **°F and mph**, with °C shown small beside the high/low.
  - **Answer:** as recommended (2026-10-05).
- **Q-W5. A scheduled daily refresh, or refresh on request only?**
  - Recommendation: **on request only** (your 12-hour rule). It covers "once a
    day" whenever anyone looks, and makes no calls when nobody does. A daily
    job could be added later if the first load after a quiet day feels slow
    (it should take a second or two).
  - **Answer:** as recommended (2026-10-05).

Currency:

- **Q-C1. Device or server caching?**
  - (a) **Device only:** the phone calls Frankfurter directly and keeps the
    rate for 12 hours (and offline).
  - (b) Server cache, like weather.
  - Recommendation: **(a)**. Frankfurter needs no key and allows browser calls,
    and the phone must keep the rate anyway for offline use. A server cache
    adds a table and an endpoint for no gain.
  - **Answer:** as recommended (2026-10-05).
- **Q-C2. Which currencies does a trip have?**
  - (a) Worked out from the trip's places (Okinawa & Taipei → JPY and TWD),
    with an "Other…" picker.
  - (b) A currency field you set on the trip (a trip document change).
  - Recommendation: **(a)**: nothing to enter, and it follows the itinerary.
  - **Answer:** as recommended (2026-10-05).
- **Q-C3. Calculator direction:** local → USD as asked, plus a swap button for
  USD → local (recommended, it's a few lines), or strictly one way?
  - **Answer:** as recommended (2026-10-05).

Pages, countdown, order:

- **Q-N1. Weather and Currency in the drawer only while a trip is open?**
  Recommendation: **yes**; both need a trip to know the places. (The
  alternative is "your current or next trip" from anywhere.)
  - **Answer:** as recommended (2026-10-05).
- **Q-D1. Midnight on which clock?**
  - (a) **The phone's** (as asked): 12:00 AM Oct 29 in Chicago, 30 minutes
    before the 12:30 AM flight.
  - (b) The trip's zone: midnight Oct 29 in Tokyo is 10 AM Oct 28 in Chicago,
    so it reaches zero a day early.
  - (c) The first booked departure ("boarding in 3 hours").
  - Recommendation: **(a)**.
  - **Answer:** as recommended (2026-10-05).
- **Q-D2. Rounding:** whole units rounded down: 2 days 23 hours reads "2
  days", 47 hours reads "1 day", 23 h 59 m reads "23 hours", and under a
  minute reads "Starting now". Recommendation: as described.
  - **Answer:** as recommended (2026-10-05).
- **Q-O1. Order:** public memories → backup → weather → currency → countdown?
  - **Answer:** as recommended (2026-10-05).

## Run stage 11 — admin: invite people, reset passwords

Asked 2026-10-05 (Julian):
- **Invite a new user.** Admins only. The default password is
  `changeme-<username>`. The option is in the ☰ drawer on the trips screen.
- **Password reset.** An admin can reset someone's password back to
  `changeme-<username>`.
- **Force a password change** while the user still has the default: on
  first login, and after a reset.

Also answered then: the dev password for `pripri@example.com` is
`changeme-viewer` (the built-in `SEED_VIEWER_PASSWORD` default).

**Decisions (answered 2026-10-05):** every recommendation: a random one-time
password (not `changeme-<username>`), a flag the server enforces, public
sign-up closed, invite by email and name, resets on the Admin page, and
Change password in the drawer.

### Where we are

- **Accounts are fastapi-users.** `POST /auth/login` returns a 60-day JWT,
  and `POST /auth/refresh` slides it.
- **`POST /auth/register` is open to anyone.** The app has no sign-up
  screen, but the endpoint is live on `pripri-trip.fly.dev`, so anyone can
  make an account. They can't see a trip without a code, but it's still a
  door nobody uses.
- **fastapi-users' `/users` router is mounted.** `PATCH /users/me` lets a
  user change their own password, and `PATCH /users/{id}` lets a superuser
  change anyone's, including setting a password. Neither has a UI.
- **JWTs aren't revoked by a password change.** A token issued before a
  reset keeps working until it expires.
- **The admin surface:** `/admin` (`current_superuser` on the router) with
  `GET /admin/users`, the Admin page (a user list) and an Admin item in the
  drawer for superusers.
- **The seed passwords already fit the pattern:** `changeme-user` for
  user@, `changeme-admin` for admin@, and the e2e suite signs in with them.

### Design (assuming the recommended answers)

**Data.** `users.must_change_password` (bool, default false; migration
0009). Invite and reset set it; changing your password clears it. A flag,
not "is the password still the default?", so the seed accounts that dev and
e2e sign in with aren't caught (Q-A2).

**API** (thin routers; logic in `services/users.py`):
- `POST /admin/users` with `{ email, name }` creates an active, verified,
  non-superuser account, with the temporary password (Q-A1) and the flag
  set. It returns the user and the temporary password, once. The temporary
  password is random and readable: three groups of four lowercase letters
  and digits, with look-alikes left out (`k7mq-x2pd-9rhw`). An email
  already in use gives 409.
- `POST /admin/users/{id}/reset-password` sets the temporary password and
  the flag, and returns the password once. You can't reset yourself (409;
  use Change password). A missing user gives 404.
- `POST /auth/change-password` takes `{ currentPassword, newPassword }`
  (signed in). It checks the current password, applies fastapi-users'
  password rules plus "at least 8 characters and not the default", and
  clears the flag. It returns a fresh token.
- **The forced change is enforced on the server** (Q-A2). While the flag is
  set, every route except `/auth/*`, `GET /users/me` and change-password
  answers **403 `PASSWORD_CHANGE_REQUIRED`**. It's one dependency
  (`require_password_ok`), added where the routers are mounted, so a new
  router can't forget it. That also locks out a session from before the
  reset: the token still signs in, but can do nothing until the password is
  changed.
- `UserRead` gains `must_change_password`, so the app knows after login.
- **Public sign-up closes** (Q-A3): the register router is unmounted. The
  README's "sign up a backup account" becomes "invite it, then make it an
  admin".

**UI:**
- **Drawer, on the trips screen, admins only:** "Invite someone" opens a
  dialog with email and name. On save it shows the temporary password with
  a copy button ("Send them this; they'll choose their own when they sign
  in"), and a toast.
- **Admin page:** each user row gets "Reset password" (two-tap confirm), then
  shows the new temporary password with copy. A "Must change password" badge
  marks anyone who hasn't yet.
- **The forced change:** after login (or on any 403
  `PASSWORD_CHANGE_REQUIRED`), the app shows a full-screen "Choose a new
  password" form (current, new, confirm) and nothing else, except Sign out.
- **"Change password"** in the drawer for everyone (the same form, closable).

### Phases

- **Phase 54 — invites, resets and the forced change (API).** ✅ (2026-10-05)
  - **Scope:** migration 0009; the two admin endpoints; change-password;
    `require_password_ok` on every feature router; register unmounted;
    `UserRead.must_change_password`; README (backup account via invite).
  - **Tests:**
    - invite makes an account that can sign in with the temporary password,
      flagged; an email in use gives 409; non-admins get 403 and anonymous
      401;
    - reset sets the password and the flag, can't target yourself, and gives
      404 for a missing user;
    - while flagged, a trip read gives 403 `PASSWORD_CHANGE_REQUIRED` but
      `/users/me` and change-password work;
    - a wrong current password, a short password or the default itself is
      refused; a good change clears the flag and everything works;
    - an old token after a reset is locked until the password changes;
    - `POST /auth/register` is gone (404/405);
    - the migration leaves existing users unflagged.
- **Phase 55 — invites, resets and the forced change (UI).** ✅ (2026-10-05)
  - **Scope:** the Invite dialog in the drawer (trips screen, admins), the
    Admin page's Reset password and badge, the forced change screen, and
    Change password in the drawer.
  - **Tests:**
    - Invite shows only for admins and only on the trips screen, and shows
      the password once with copy;
    - Reset needs a second tap and shows the new password;
    - a flagged user lands on the forced form and can only sign out or
      change it; afterwards the app opens normally;
    - Change password validates (match, length) and shows a toast.
  - **E2E:** the admin invites a throwaway user, who signs in and is made to
    change the password. The admin resets it, and it's forced again.
    Screenshots at 375 px.

### Built (2026-10-05): Phases 54–55

Built as planned, one commit each, with `make verify` green (227 API + 341
UI tests). The e2e suite (23 specs) passes, including the new
`accounts.spec.js`: invite, forced change, reset, forced again. It reuses one
throwaway account, `e2e-invitee@example.com`, since accounts can't be
deleted. Screenshots `40`–`42`.

**Details:**
- The gate (`require_password_ok`, in `app/users.py`) is mounted on every
  feature router in `main.py`. The photo router guards only its upload and
  delete routes, because serving photos is login-free. Still reachable with a
  temporary password: `/auth/*` (login, refresh, change-password) and
  fastapi-users' `/users/me`.
- The new password must be at least 8 characters, differ from the current
  one, and not start with "changeme".
- The UI handles 403 `PASSWORD_CHANGE_REQUIRED` in the API client: it turns
  on the forced screen instead of showing an error toast. `ProtectedRoute`
  and `AdminRoute` both show the forced screen.
- `CopyField` (the copy box) is shared by the Share dialog, the invite and
  the reset.
- On the Admin page, the Password column sits next to Email, so Reset stays
  beside the right person at 375 px (the table scrolls sideways).
- Fixed along the way: a Currency test cleared the page by hand; it now uses
  `cleanup()`.

**Before relying on it (Julian):**
- Deploy. Fly runs migration 0009 on start, and existing accounts aren't
  affected.
- Public sign-up is gone, so new accounts come from Invite someone. That
  includes the Pi's backup account (README updated).
- If `pripri@example.com` exists on Fly with the seed password, reset it
  from the Admin page, or leave it, since it's only on the sample trip.

### Open questions (Run stage 11)

- **Q-A1. The temporary password.**
  - (a) `changeme-<username>`, as asked. "Username" means the part of the
    email before the @, so `pripri@example.com` would get
    `changeme-pripri`.
  - (b) A random one-time password (e.g. `maple-orbit-42`) that the admin
    sees once, with copy, and sends.
  - The catch with (a): the site is public, so anyone who knows (or guesses)
    the email can sign in before the real person does, change the password
    and keep the account. The forced change doesn't help, because the
    intruder makes the change. The same goes for the window after every
    reset.
  - Recommendation: **(b)**. It's the same flow for you (copy, text it),
    just not guessable.
  - **Answer:** as recommended (2026-10-05).
- **Q-A2. How is "still has the default" detected and enforced?**
  - (a) A flag set by invite and reset, cleared by a change, and enforced
    by the server (every route but auth answers 403 until changed).
  - (b) Compare the password with the default at each login. That would also
    catch the dev seed accounts (`changeme-user` and `changeme-admin` fit
    the pattern) and force them to change, breaking the e2e suite's
    sign-ins.
  - (c) The flag, but enforced only by the app's screens.
  - Recommendation: **(a)**. The server enforcing it also locks out an old
    session after a reset.
  - **Answer:** as recommended (2026-10-05).
- **Q-A3. Close public sign-up?** `POST /auth/register` lets anyone make an
  account today (no screen, but the endpoint is live).
  - Recommendation: **yes**, now that admins invite people.
  - **Answer:** as recommended (2026-10-05).
- **Q-A4. What does an invite take?**
  - (a) Email and name.
  - (b) Also a trip and a role, joining them to it straight away (handy for
    the in-laws).
  - (c) Also "make admin".
  - Recommendation: **(a)** for now. They join with a code as today, and
    "admin" stays a deliberate `make_admin`.
  - **Answer:** as recommended (2026-10-05).
- **Q-A5. Where do resets live?** Recommendation: on the **Admin page**,
  per user (the drawer item stays "Invite someone", as asked). Plus
  **"Change password" in the drawer for everyone**, since the forced change
  needs that form anyway.
  - **Answer:** as recommended (2026-10-05).

## Run stage 12 — seed accounts, small fixes, map zoom, packing lists, documents

Asked 2026-10-05 (Julian):
- **Forced change:** don't make people re-type the temporary password.
- **Countdown:** on the right of the trip card, so it stands out.
- **Backup tool:** a really easy way to test it locally.
- **Packing lists:** checklists in a few lists (clothes, electronics,
  toiletries, …).
- **Travel legs:** show the duration.
- **Map:** filtering to a day (or a "what" filter) pans and zooms to what's
  left, even if that spans countries.
- **Documents:** a drawer feature, editors only. Upload files to Fly, versioned;
  before the trip, download the latest version of each as one zip, as a hard
  copy fallback. Not cached in the app.
- **Seed data:** new accounts and the Okinawa trip in the seed. Withdrawn
  2026-10-06: the seed stays as it is.

**Decisions (answered 2026-10-06):** the seed doesn't change; every other
recommendation taken (Q-B1, Q-B4–Q-B7). The backup tool's simplification is
still open (Q-B8).

### Where we are

- **The forced change** (`ForcedPasswordChange.jsx` → `ChangePasswordForm`)
  asks for the current password, and `POST /auth/change-password` requires it.
  The person typed it seconds earlier on the login screen.
- **The countdown** is a line in the middle of the card's text column
  (`TripsPage.jsx`, `TripCard`), between the dates and the stay/leg counts.
- **The backup script** (`scripts/pi-backup/pripri_backup.py`) reads its
  settings from the environment and already has `BACKUP_REQUIRE_MOUNT=0`, so
  it can run on any machine against the local API. Nothing documents that,
  and the seed trips have no photos to back up.
- **Travel** stores wall-clock `depart`/`arrive`; the zones come from the
  places (`zones.depart_zone`/`arrive_zone`). So a duration can be computed on
  read, across time zones, without storing anything.
- **The map** fits its bounds once, on load, to stays and activities (not
  travel endpoints). Changing a filter only hides markers; the view stays put.
- **"Versioning" today** (`services/versions.py`) is optimistic concurrency
  (If-Match, 409 on a stale edit), not a file history. Documents need their
  own version rows; the If-Match check can still guard rename/delete.
- **Files:** photos live on the Fly volume behind `PhotoStore`
  (`/data/photos`). nginx caps a request at 26 MB, the VM has 512 MB (the
  photo OOM fix, Run stage 5), and photos are served without login.
- **The seed** makes `user@` (owns Bern + Athens), `admin@` and `pripri@`
  (viewer on both). The API tests, the UI tests and the e2e suite (23 specs)
  sign in as these. `make seed-remote` **replants** the seeded trips on Fly,
  deleting their memories and photos.

### Design (assuming the recommended answers)

**1. Forced change without re-typing (Q-B1).** The login form passes the
password it just sent to the forced-change screen, in memory only (Redux,
never storage, cleared once used or on sign out). The form then hides the
"current password" field and sends it itself. If the app was reopened later
(no password in memory), the field shows as today. No API change, so an old
session after an admin reset still can't set a password without knowing the
temporary one.

**2. Countdown on the right.** The card's right column (where ⋯ is) gets the
countdown stacked: the number large (`23`), the unit small (`days to go`), in
`text-primary`, right-aligned, with ⋯ above it. The line in the middle goes.
"Starting now" fits the same slot. At 375 px the name still wraps in the
left column.

**3. The backup tool (Q-B8).** Open: see the question.

**4. Seed.** Unchanged (withdrawn).

**5. Travel duration (Q-B6).** The travel read schema gains
`durationMinutes` (null without an arrival), computed in the service from
the wall-clock times and their zones. Shown on the timeline's travel row
after the times (`2h 35m`, `13h 50m`; days only past 24 h: `1d 2h`) and in
the details sheet. Not stored, not in the trip document.

**6. Map zooms to the filters (Q-B7).** Whenever the day or "what" filter
changes, the map fits to the markers left: two or more → `fitBounds` with
padding; one → centre on it at zoom 14; none → stay put. With a day filter,
travel endpoints count (a flight day spans the flight, as asked). With no
filter, it returns to the trip's initial fit (stays and activities). A pure
`boundsFor(markers, filters)` helper carries the logic, so it's testable
without Google. Panning by hand isn't overridden until the next filter
change.

**7. Packing lists (Q-B4).**
- **Data:** `packing_items` (UUID, `trip_id`, `user_id` (whose list),
  `category`, `text`, `checked`, `position`, soft delete). Migration 0010.
  A list is a category; no separate table.
- **Per person, per trip:** each member, viewers included, has their own lists
  (PriPri and Julian pack different bags). Others can't see them (404).
- **Categories:** Clothes, Toiletries, Electronics, Documents & money,
  Health & meds, Beach & outdoors, Carry-on, Other. Empty ones collapse.
- **Starter items:** "Start from suggestions" fills a few per category
  (passport, chargers, plug adapter, sunscreen, …), each deletable. Shown
  only while your list is empty.
- **API:** `GET/POST /trips/{id}/packing`, `PATCH/DELETE
  /trips/{id}/packing/{item}`, `POST /trips/{id}/packing/suggestions`.
  Single-owner rows, so no If-Match.
- **UI:** "Packing" in the drawer's Trip tools (`ToolLayout`). Lists as
  sections with a count (`7/12`), tap to check, add a line per section, ⋯ to
  rename/delete. Checks are optimistic, with a toast on failure. A "Hide
  packed" switch. Online only for now (packing happens at home).

**8. Documents (Q-B5).**
- **Data:** `documents` (UUID, `trip_id`, `name`, `created_by`, soft delete,
  `VersionedMixin` for rename/delete conflicts) and `document_versions`
  (UUID, `document_id`, `number`, `filename`, `content_type`, `size`,
  `sha256`, `uploaded_by`, `uploaded_at`). Migration 0011.
- **Files:** a `DocumentStore` like `PhotoStore`, at `DOCUMENT_DIR`
  (`/data/documents` on Fly): `<trip>/<document>/<version>/<filename>`.
  Never served without login.
- **Who:** the owner and editors. Viewers get 404 and no drawer item.
- **API:**
  - `GET /trips/{id}/documents`: each with its latest version and the count.
  - `POST /trips/{id}/documents` (multipart: file, optional name) → version 1.
  - `POST /trips/{id}/documents/{doc}/versions` (file) → the next version.
  - `GET …/{doc}/versions`; `GET …/versions/{n}/file` downloads one.
  - `PATCH …/{doc}` (rename) and `DELETE …/{doc}` (soft) with If-Match.
  - `GET /trips/{id}/documents.zip`: the latest version of each live
    document, named `<document name>.<ext>` (deduplicated), written to a temp
    file in chunks (`ZIP_STORED`, since PDFs and photos don't compress), then
    streamed, so 512 MB isn't at risk.
  - Limit 25 MB per file (under nginx's 26 MB). PDFs, images, and plain
    office files; anything else is 415.
- **UI:** "Documents" in Trip tools for editors. A list (name, version,
  date, size). Upload (file picker, camera on the phone), "Upload new
  version", Versions (download any), Rename, Delete (two-tap). "Download all
  (zip)" fetches through `apiClient` (so the token goes with it) and saves
  the blob as `<trip name> documents.zip`. Nothing is cached offline.
- **Pi backup:** not in this stage (Q-B5e).

### Phases

- **Phase 56 — forced change without re-typing, countdown on the right,
  travel duration.**
  - **Scope:** items 1, 2 and 5 (API: `durationMinutes`; UI: three changes).
  - **Tests:** the forced form after login has no current-password field and
    succeeds; after a reload it asks for it; the password never reaches
    storage; the countdown renders in the right column (and not for
    started trips); `durationMinutes` across zones (Chicago → Tokyo), with no
    arrival (null), and overnight; formatting (`45m`, `2h 5m`, `1d 2h`).
  - **E2E:** forced change in `accounts.spec.js` without the current
    password. Screenshots at 375 px: trips list, travel row.
- **Phase 57 — the map follows the filters.**
  - **Scope:** item 6.
  - **Tests:** `boundsFor` (none, one, many; travel counted only with a day;
    no filter = the initial fit); MapPage calls `fitBounds`/`setZoom` on
    filter change and not on a re-render.
  - **E2E:** on the seeded Athens trip, pick the Chicago → Athens travel day, then an Athens day; screenshots.
- **Phase 58 — packing lists (API).** Migration 0010, model, service,
  router, suggestions. **Tests:** CRUD; someone else's list is 404; a viewer
  can keep their own list; suggestions only fill an empty list; soft delete.
- **Phase 59 — packing lists (UI).** Slice, page, drawer item. **Tests:**
  check/uncheck (optimistic, rolled back on failure), add, rename, delete,
  Hide packed, suggestions; 375 px by eye.
- **Phase 60 — documents (API).** Migration 0011, models, store, router,
  zip. **Tests:** upload; new version bumps the number and keeps the old
  file; latest-only zip with duplicate names handled; viewers 404 on every
  route, anonymous 401; 25 MB and type limits; rename/delete with If-Match
  (409 stale); a deleted document is left out of the zip.
- **Phase 61 — documents (UI).** Slice, page, drawer item for editors.
  **Tests:** hidden for viewers; upload / new version / versions / rename /
  delete; Download all calls the zip endpoint and saves a blob. **E2E +
  by hand:** download the zip on a real iPhone and open it in Files.

### Open questions (Run stage 12)

- **Q-B1. Skipping the temporary password: how?**
  - (a) The app remembers what was typed at login (memory only) and fills
    it in. No server change. After a reopen, it asks.
  - (b) The server stops asking for the current password while the flag is
    set. Simpler, but it undoes a Phase 54 guarantee: whoever holds an old
    session (the lost phone that prompted the reset) could set the password
    without knowing the temporary one, and take the account.
  - Recommendation: **(a)**.
  - **Answer:** as recommended, (a) (2026-10-06).
- **Q-B2. The seed accounts.**
  - (a) Keep `user@`/`admin@` and the Bern trip as test fixtures (the API
    tests and e2e suite depend on them), as in the table. Replace `pripri@`
    with `viewer@`.
  - (b) Retire them and move the tests onto Julian/gabrom/viewer. Real
    emails in test fixtures, and rewriting most of the e2e suite.
  - Recommendation: **(a)**. Also: gabrom's display name? (I'll use
    "Gabrom" unless you say otherwise.) Should viewer@ also see Bern? (yes,
    so the e2e viewer specs keep working.)
  - **Answer:** withdrawn: no seed changes (2026-10-06).
- **Q-B3. Seeding Fly, and forcing a change.**
  - Okinawa on Fly: import only if missing, never replant (recommended), or
    leave Okinawa out of `seed-remote` entirely?
  - Should gabrom's account start with the "must change password" flag (so
    they choose their own on first sign-in)? Recommendation: **yes for
    gabrom, no for Julian and viewer@** (you'd be forced again after every
    `make reset-db`).
  - Does a `julian.h.dale@gmail.com` account already exist on Fly? If so,
    the seed leaves its password alone; if your existing Okinawa trip there
    has a different name, the seed would add a second copy, so it might be
    better to skip `seed-remote` for this.
  - **Answer:** withdrawn: no seed changes (2026-10-06).
- **Q-B4. Packing lists.**
  - (a) Per person per trip (recommended), (b) one shared list per trip,
    (c) both: your own lists plus a "Shared" list everyone ticks.
  - The categories above: OK, or add/remove (e.g. Snorkel gear, Kids,
    Gifts)? Can you add your own lists?
  - Starter suggestions: yes (recommended), or always start empty?
  - Carry over: copy last trip's list (later), or not needed?
  - **Answer:** as recommended (2026-10-06).
- **Q-B5. Documents.**
  - a. Editors and the owner only; viewers don't see it at all? (recommended)
  - b. 25 MB per file; PDFs, images, Word/Excel/text. Enough?
  - c. Old versions downloadable one at a time (recommended), or only kept
    on the server?
  - d. Delete: soft (recommended), so an accidental delete can be undone
    from the database.
  - e. Back documents up to the Pi as well? Recommendation: later, as a
    small follow-up to the backup script.
  - f. These may be passports and tickets. Fly volumes are encrypted at rest
    and every route needs sign-in and editor; anything more (e.g. a
    separate passphrase) is out of scope unless you want it.
  - **Answer:** as recommended (2026-10-06).
- **Q-B6. Travel duration.** Computed, not stored or editable;
  shown on the timeline row and in the details. OK? (Flights with no
  arrival time just show none.)
  - **Answer:** as recommended (2026-10-06).
- **Q-B7. Map.** Fit to the filtered markers on every filter change,
  including travel endpoints when a day is picked; clearing goes back to the
  trip fit. OK?
  - **Answer:** as recommended (2026-10-06).

- **Q-B8. The backup tool, simpler.** Today it's five files: the Python
  script, `install.sh`, a systemd `.service` and `.timer`, and an
  `.env.example`. The script is the only one that does the backup; the rest
  install it to run every 30 minutes as a sandboxed system service.
  - (a) Keep it as it is, and only add `make pi-backup-local` and a README
    "Try it locally".
  - (b) Shrink it: the script reads its settings from a file next to itself
    (`scripts/pi-backup/backup.env`, gitignored), so it's just `python3
    pripri_backup.py` anywhere, and one `crontab -e` line runs it every 30
    minutes, logging to a file. `install.sh`, the `.service` and the `.timer`
    go. You lose the systemd sandbox (read-only except the drive), the
    catch-up run after the Pi was off, and `journalctl`; the drive-mounted
    check stays.
  - Recommendation: **(b)** for a two-person setup, unless it's already
    installed on the Pi and working, in which case (a).
  - **Answer:**

## After Phase 4 — First real trip

Julian provides the itinerary. We convert it to a trip document, validate it
against the schema, and import it through the UI. Anything the format can't
express goes into the backlog rather than being forced in.

## Later / Backlog

- **Walk:**
  - Editing the trip header (name, dates, timezone). Activities are done;
    stays and travel are planned above.
  - Export a trip as a document → Run stage 8.
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
