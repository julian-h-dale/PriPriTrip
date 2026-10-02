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
- **Import always creates.** `POST /trips/import` builds a brand-new trip. Any
  ids inside the document are ignored, because the schema has no id fields.
  Nothing is updated, merged or replaced.
- **All-or-nothing, reject on any error** (answered 2026-10-01; can relax
  later). Every error is returned in one 422 response, each with a JSON path.
- **One write path.** All trip writes go through `services/trips.py`. The
  import, and later editing, call it. Routers stay thin (template convention).
- **Read shape = document shape.** `GET /trips/{id}` returns the trip in the
  `TripDocument` shape, plus ids and audit fields. The UI renders from it, and a
  future "export" is the same payload.
- **Tables:** `trips`, `stays`, `days`, `items`. All have UUID PKs and soft
  delete. `trips.user_id` holds ownership, and children are reached only
  through an owned trip (`get_owned_trip`, 404 otherwise). There's a unique
  constraint on `(trip_id, date)` for days. Locations are a JSON column, not a
  table. Travel fields (`travel_mode`, `travel_carrier`, `travel_number`) are
  nullable columns on `items`.
- **SQLite gotcha.** Foreign keys are not enforced unless
  `PRAGMA foreign_keys=ON` is set per connection, so add it on engine connect.
  Avoid dialect-specific SQL.
- **Time model** (lessons §3):
  - Plain dates are `DATE`.
  - Wall-clock values are a naive `DATETIME` plus a nullable IANA zone string
    (`null` means use the trip's `timezone`).
  - `Trip.timezone` is required, and every zone must be a valid IANA name
    (`zoneinfo`).
  - Validation converts to UTC only to compare across zones (for example,
    flight end vs start). UTC is never stored for trip content in crawl.
- **Wall-clock format on the wire:** `YYYY-MM-DDTHH:MM` (seconds allowed, no
  offset). An offset or `Z` is rejected (template `WallClockTime` rationale).
- **Import validation rules** (reject):
  1. `endDate ≥ startDate`.
  2. Every `day.date` falls within the trip range, with no duplicate dates.
  3. Each item's `start` is on its day's date. An item's `end` may fall on a
     later date (overnight travel) but must come after `start`, compared as
     instants.
  4. A stay has `checkOut > checkIn` (as instants). Its check-in date is within
     the trip range, and its check-out is no later than `endDate + 1`.
  5. `travel` is present only when `kind = "travel"`, and `from`/`to` only on
     travel items. `location` is only on activity items.
  6. Unknown fields are rejected (`extra="forbid"`), so typos fail loudly
     instead of being dropped.
  7. File limit: 1 MB, UTF-8 JSON.
- **Ordering:** days sort by date. Within a day, items keep their document
  order, which is the author's intended sequence and covers untimed items.
  Items are not re-sorted by time. Each item stores a `position` integer.
- **Stays render as computed markers.** Check-in goes on the check-in date,
  "staying at" on each night in between, and check-out on the check-out date.
  This is computed in the UI from `trip.stays` and never stored.
- **Frontend:**
  - Features `features/trips/` (home and import) and `features/timeline/`,
    with one slice per feature (template convention).
  - Times are shown verbatim via a single `formatWallClock` helper. Never call
    `dayjs(isoString)` on a wall-clock value.
  - `react-markdown` + `remark-gfm` render notes and summaries.
  - shadcn/Tailwind dark theme per `design_doc.md`.
- **The `things` example slice is removed** in Phase 2, once trips replace it as
  the reference slice.

## Open Questions / Design Decisions

Answered 2026-10-01, before this plan was written (already folded into the
body above):

- **Stays:** trip level, with their own rules, not derived into days. Resolved.
- **Markdown** in notes and summaries: yes. Resolved.
- **Template login and per-user ownership:** keep. Resolved.
- **Invalid import:** reject for now and relax later. Resolved.
- **v1 material** goes in `reference/`. Resolved.

Still open:

1. **Dates with no `days[]` entry: show or hide?**
   - Options:
     - (a) The timeline shows every date from start to end, and missing dates
       render as an empty "No plans" day.
     - (b) Show only the days in the document.
     - (c) Reject the import unless every date has a day.
   - Recommendation: **(a)**. The gap is visible without being an error, and it
     matches v1's `EMPTY_DAY` intent.
   - **Answer:** _(fill in)_
   - **Resolved:** _(fill in)_

2. **Overnight travel: show an arrival row on the arrival date?**
   - Options:
     - (a) A travel item whose `end` falls on a later date also shows a computed
       "Arrive <to>" marker on that date, just like stay markers.
     - (b) Show it only on the departure day, with the arrival time displayed as
       "+1 day".
   - Recommendation: **(a)**. Otherwise the day you land looks empty until you
     scroll back.
   - **Answer:** _(fill in)_
   - **Resolved:** _(fill in)_

3. **Item order within a day: document order or start time?**
   - Options: (a) document order, as above; (b) sort timed items by start time
     and keep untimed items in document position.
   - Recommendation: **(a)**. It's simple and predictable, and the author
     controls the sequence. Sorting can come with editing.
   - **Answer:** _(fill in)_
   - **Resolved:** _(fill in)_

4. **Trip deletion in the UI in crawl?**
   - Since every import creates a new trip, iterating on a document will pile
     up duplicates.
   - Recommendation: **yes**. Soft delete from the home screen, with a confirm
     dialog using the destructive color.
   - **Answer:** _(fill in)_
   - **Resolved:** _(fill in)_

5. **What should `make seed` load?**
   - Options:
     - (a) A small synthetic 3-day sample trip in the new format. It's also the
       test fixture and the example in the schema docs.
     - (b) Nothing; trips only come from imports.
   - Recommendation: **(a)**. The app shows something real after `make
     reset-db`, and the sample doubles as the documentation example. Your real
     itinerary is imported by hand later.
   - **Answer:** _(fill in)_
   - **Resolved:** _(fill in)_

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

## Phase 1 — Crawl: Trip document, schema & models

**Goal:** the trip document is defined, validated, published as a JSON Schema,
and has tables to land in.

**Scope:**
- `api/app/trip_document.py`:
  - `TripDocument`, `StayDoc`, `DayDoc`, `ItemDoc`, `LocationDoc`, `TravelDoc`,
    all CamelModel with `extra="forbid"`.
  - Field validators (IANA zones, wall-clock format).
  - A model validator implementing import rules 1–5 that collects *all* errors
    with paths.
- `schema/trip.schema.json`, generated by `make schema` (a script that runs
  `TripDocument.model_json_schema()`), with titles and descriptions on every
  field.
- SQLAlchemy models `Trip`, `Stay`, `Day`, `Item` per the Architecture
  Decisions, with `PRAGMA foreign_keys=ON`.
- `api/tests/fixtures/sample_trip.json`, the synthetic 3-day trip. It includes
  a stay spanning nights, an overnight-or-cross-zone travel leg, untimed
  activities, and markdown notes.

**Out of scope:** endpoints, UI.

**Tests / verification:**
- [ ] `make verify` passes
- [ ] The sample trip validates; a mutated copy fails, one per rule 1–6, with
      the expected path
- [ ] The committed `schema/trip.schema.json` equals the freshly generated one
- [ ] The sample trip also validates against the JSON Schema itself (via the
      `jsonschema` package), so the published schema is not looser than
      expected for the happy path
- [ ] `make reset-db` creates the new tables

---

## Phase 2 — Crawl: Import & read API

**Goal:** a trip document goes in through the API and comes back out in the
same shape.

**Scope:**
- `services/trips.py`: `import_trip(db, user_id, doc) -> Trip` (one
  transaction), `list_trips`, `get_trip_document`, `delete_trip` (soft).
  Assembly uses explicit eager loading.
- `routers/trips.py`:
  - `POST /trips/import`: multipart file, or a JSON body as a convenience for
    curl/tests. Returns 201 with the trip summary.
  - `GET /trips`: summaries, soonest start first.
  - `GET /trips/{id}`: the full document plus ids.
  - `DELETE /trips/{id}`: 204, soft delete.
  - `GET /schema/trip`: unauthenticated, read-only.
- Validation errors become a 422 `{errors: [{path, message}]}`. Malformed JSON
  and oversize files get clear 4xx responses.
- Remove the `things` slice on both backend and frontend. Seed loads the sample
  trip if Q5 is answered (a).

**Tests / verification:**
- [ ] `make verify` passes
- [ ] `make seed` covers this phase's new data, and the result is visible in the app (via API)
- [ ] Round trip: import the sample, then `GET` returns a document equal to the
      input (ignoring ids and audit fields)
- [ ] Importing the same file twice creates two distinct trips
- [ ] An invalid doc returns 422 with all errors and leaves no rows behind
- [ ] Another user's trip returns 404 on GET and DELETE; an anonymous request
      returns 401
- [ ] A deleted trip disappears from `GET /trips`

---

## Phase 3 — Crawl: Home screen (trip select & import)

**Goal:** after logging in, I see my trips, can import a new one, and can open
or delete one.

**Scope:**
- `features/trips/`: a trips slice (list, import, delete) and `TripsPage` at
  `/`.
  - Trip cards show name, date range, and day/stay counts.
  - An empty state has an "Import trip" button.
- An import dialog: file picker → upload.
  - Success: toast, then navigate to `/trips/:id`.
  - Failure: the error list is shown inline in the dialog, as a scrollable list
    of path → message.
- Delete with a confirm dialog (if Q4 = yes).
- `formatWallClock` / `formatDateRange` helpers with tests.

**Tests / verification:**
- [ ] `make verify` passes
- [ ] `make seed` covers this phase's new data, and the result is visible in the app
- [ ] Component tests: list renders, empty state, import success navigates,
      import failure shows path-tagged errors, delete confirms first
- [ ] Manual: phone width (375px), dark theme, keyboard focus visible

---

## Phase 4 — Crawl: Trip timeline

**Goal:** the trip reads well as an expandable day-by-day timeline.

**Scope:**
- `features/timeline/`: `TripTimelinePage` at `/trips/:id`.
  - Header: name, dates, timezone.
  - Day rows show date, weekday and title, collapsed by default. Expanding
    shows the summary (markdown) and the day's entries.
  - Entries: items in document order, plus computed stay markers. Overnight
    arrival markers depend on the Q2 answer, and empty days on Q1.
  - Item rows show an icon by kind and travel mode, the time range (wall clock,
    with a zone label when it differs from the trip's), and the title.
    Expanding shows notes (markdown), location with a maps link, confirmation
    number (tap to copy), and travel details.
- `buildTimeline(trip)`: a pure function from document to rendered rows. All
  the marker logic lives here and is unit-tested.
- Loading skeleton, and a not-found state for a 404.

**Tests / verification:**
- [ ] `make verify` passes
- [ ] `make seed` covers this phase's new data, and the result is visible in the app
- [ ] `buildTimeline` unit tests: a multi-night stay produces check-in, staying
      and check-out markers on the right dates; overnight travel; empty days;
      document order kept
- [ ] Times render identically with the test process in two different `TZ`
      values
- [ ] Component tests: expand/collapse a day and an item; markdown renders
- [ ] Manual: phone width, long titles wrap cleanly, dark-theme contrast

---

## After Phase 4 — First real trip

Julian provides the itinerary. We convert it to a trip document, validate it
against the schema, and import it through the UI. Anything the format can't
express goes into the backlog rather than being forced in.

## Later / Backlog

- **Walk:**
  - Editing through hand-written forms (stay, item, day, trip), via
    `services/trips.py` with PATCH semantics using `exclude_unset`.
  - Export a trip as a document.
  - Item sorting options.
- **Walk:** verification/gaps, rebuilt from `docs/lessons_learned.md`. Decide up
  front whether a screen answers "is it sound?" or "what's missing?".
- **Run:**
  - Maps and Places lookup (the server resolves coordinates; never trust
    model-supplied coordinates).
  - "What's Next" active-trip mode (derive status from dates, never store it).
  - Share links.
  - Offline/PWA.
- **Run, much later:** AI-assisted import (let the model do language, not data).
- Before any real deploy: Alembic and pinned Python dependencies.
