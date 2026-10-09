# Implementation Plan — PriPriTrip (rebuild)

This file is the **index**: what the app is built on, where each stage's plan
lives, and the backlog. Each stage's full plan (design, phases, tests, open
questions and their answers, "Built" notes) is its own file in
[`docs/plan/`](docs/plan/).

**Read this file and the current stage's file only.** Open an older stage's
file when you need its history (why something is the way it is); `grep -rn
docs/plan` finds a decision quickly.

**Adding a stage:** copy the shape of a recent one (e.g.
[run-14](docs/plan/run-14-swipe-between-entries.md)) into
`docs/plan/run-NN-<slug>.md` — Where we are, Design, Phases (scope + tests),
Open questions — then add a row below. Answers go inline in that file, and
the body is updated to match (AGENTS.md, step 3).

## Summary

Rebuilt from `project-template`, from the trip document outward: crawl
(Phases 0–4: the trip document, import, timeline), walk (editing, time
zones, photos, the map), then run stages (offline, sharing, the journal and
photos, several editors, tools). Phases are numbered across the whole
project; the next one is **91**.

## Stages

All complete unless marked. Current branch: `alternate-days` (Run 25, planning).

| Stage | Phases | What | Plan |
|---|---|---|---|
| Crawl | 0–4 | Trip document, import, home screen, timeline | [crawl-phases-0-4.md](docs/plan/crawl-phases-0-4.md) |
| Walk 1 | 5–6 | Editing day activities | [walk-1-editing-activities.md](docs/plan/walk-1-editing-activities.md) |
| Walk 2 | 7–9 | Editing stays & travel, location-based time zones, vertical timeline | [walk-2-stays-travel-timezones.md](docs/plan/walk-2-stays-travel-timezones.md) |
| Walk | 10–12 | Day rows with cities, day pages, stays/travel coverage views | [walk-phases-10-12.md](docs/plan/walk-phases-10-12.md) |
| Walk 3 | 13–15 | Location photos, bottom nav, map view | [walk-3-photos-bottom-nav-map.md](docs/plan/walk-3-photos-bottom-nav-map.md) |
| Run 1 | 16–19 | Map place search, add from the map, installable offline app | [run-01-map-search-offline.md](docs/plan/run-01-map-search-offline.md) |
| Run 2 | 20–24 | "Find it fast": Today tab, landing, drawer, search | [run-02-find-it-fast.md](docs/plan/run-02-find-it-fast.md) |
| Run 3 | 25–28 | Sharing a trip; the trip journal (memories) | [run-03-sharing-journal.md](docs/plan/run-03-sharing-journal.md) |
| Run 4 | 29–33 | Offline memories, location, photos | [run-04-offline-journal-photos.md](docs/plan/run-04-offline-journal-photos.md) |
| Run 5 | 34–36 | Take photo, staying signed in, photos wait for Wi-Fi | [run-05-take-photo-wifi-uploads.md](docs/plan/run-05-take-photo-wifi-uploads.md) |
| Run 6 | 37–39 | Places in the seed data, map filters and pins, swiping days | [run-06-seed-places-map-filters-swipe-days.md](docs/plan/run-06-seed-places-map-filters-swipe-days.md) |
| Run 7 | 40–42 | More than one person editing a trip (versions, 409s) | [run-07-multiple-editors.md](docs/plan/run-07-multiple-editors.md) |
| Run 8 | 43–44 | Export a trip | [run-08-export.md](docs/plan/run-08-export.md) |
| Run 9 | 45 | One look for an entry's details | [run-09-entry-details-look.md](docs/plan/run-09-entry-details-look.md) |
| Run 10 | 46–53 | Public memories, photo backup to the Pi, weather, currency, countdown | [run-10-public-memories-backup-weather-currency.md](docs/plan/run-10-public-memories-backup-weather-currency.md) |
| Run 11 | 54–55 | Admin: invite people, reset passwords | [run-11-admin-invites.md](docs/plan/run-11-admin-invites.md) |
| Run 12 | 56–61 | Seed accounts, small fixes, map zoom, packing lists, documents, time zones | [run-12-seed-fixes-packing-documents.md](docs/plan/run-12-seed-fixes-packing-documents.md) |
| Run 13 | 62–64 | A full page for an entry's details | [run-13-entry-page.md](docs/plan/run-13-entry-page.md) |
| Run 14 | 65–66 | Swipe up and down between a day's entries; Back goes where you came from | [run-14-swipe-between-entries.md](docs/plan/run-14-swipe-between-entries.md) |
| Run 15 | 67 | New memory in the top bar, Share in the drawer, temperature on Today | [run-15-new-memory-top-bar.md](docs/plan/run-15-new-memory-top-bar.md) |
| Run 16 | 68–71 | Points of interest, one Filter button, the map's List button | [run-16-points-of-interest.md](docs/plan/run-16-points-of-interest.md) |
| Run 17 | 72–75 | Quiet offline, making someone an admin, what viewers see (and their map) | [run-17-offline-toasts-roles-viewers.md](docs/plan/run-17-offline-toasts-roles-viewers.md) |
| Run 18 | 76–78 | Usage analytics (Umami): a per-user switch, page views and Trip tools by role | [run-18-analytics.md](docs/plan/run-18-analytics.md) |
| Run 19 | 79 | Analytics that survive being offline (our own sender, a queue) | [run-19-offline-analytics.md](docs/plan/run-19-offline-analytics.md) |
| Run 20 | 80–81 | A "saved copies only" switch (data saver) | [run-20-data-saver.md](docs/plan/run-20-data-saver.md) |
| Run 21 | 82–84 | Field fixes: trips open on Today, Tonight's check-out, sticky hover, search details, packing offline | [run-21-field-fixes.md](docs/plan/run-21-field-fixes.md) |
| Run 22 | 85–86 | Light mode (and text size) | [run-22-light-mode.md](docs/plan/run-22-light-mode.md) |
| Run 23 | 87 | Large text: entry rows stack | [run-23-large-text.md](docs/plan/run-23-large-text.md) |
| Run 24 | 88–90 | Photos and memories are never dropped: iPhone camera photos (MPO), a stuck-not-dropped outbox, failed phone saves | [run-24-photo-upload-resilience.md](docs/plan/run-24-photo-upload-resilience.md) |
| Run 25 | 91–92 | **Planning.** Plan B: a hidden backup plan for a day, switched on from the day page | [run-25-plan-b.md](docs/plan/run-25-plan-b.md) |

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
- **Field review (2026-10-07):** [docs/ui-review-2026-10-07.md](docs/ui-review-2026-10-07.md).
  Scheduled in Runs 20–22. **Deferred:** documents offline (airline apps
  and Google Wallet keep boarding passes), phone numbers on stays and
  activities. Not taken up yet: map framing, the doubled offline map row,
  viewers' Currency / Time zones, the Add activity sheet, the Admin table
  at 375 px, and the "missing things" list.
- Today tab: show it only while a trip is active (a switch on the whole
  view), once it has been tested.
