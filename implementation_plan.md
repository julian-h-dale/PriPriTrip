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

## Walk stage 2 — editing stays & travel, location-based timezones, vertical timeline

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
- **Phase 9 — Walk: stay & travel forms.**
  - A small Google Places browser wrapper (mocked in tests), `PlaceField`,
    `StayForm`, `TravelForm`; `ActivityForm` switched to `PlaceField`.
  - Edit and Delete on markers; the Add menu; the arrival warning.
  - Tests and a phone-width check.
  - A live Places check needs Julian's key.

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
  - Share links.
  - Offline/PWA.
- **Run, much later:** AI-assisted import (let the model do language, not data).
- Before any real deploy: Alembic and pinned Python dependencies.
