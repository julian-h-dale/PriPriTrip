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

## After Phase 4 — First real trip

Julian provides the itinerary. We convert it to a trip document, validate it
against the schema, and import it through the UI. Anything the format can't
express goes into the backlog rather than being forced in.

## Later / Backlog

- **Walk:**
  - Editing through hand-written forms (stay, travel, activity, day, trip), via
    `services/trips.py` with PATCH semantics using `exclude_unset`.
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
