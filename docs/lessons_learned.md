# Lessons Learned — PriPriTrip v1 (2026)

The first PriPriTrip was built quick and dirty: FastAPI + Postgres, React + MUI,
and then a large LLM chat assistant on the never-merged `llm-translate` branch.
It served its purpose. This rebuild (on `project-template`) starts over, and
this document is how we avoid paying for the same mistakes twice.

The old code is still in git: `main` before the rebuild, and the
`llm-translate` branch (≈45k lines ahead of `main`). The most useful write-ups
were copied into [`reference/legacy-docs/`](../reference/legacy-docs/) —
`full_report.md` is the best single description of where v1 ended up.

---

## 1. One write path — rules live in exactly one place

**What happened.** The chat executor and the REST routers each wrote trip data
and each implemented the domain rules. They drifted. All three verified
correctness bugs in `review.md` (R1–R3) came from it:

- a trip built in chat stayed `status="new"`, so a later itinerary import (a full
  replace) silently deleted it;
- chat-created stays were stamped `UTC` instead of the venue's zone — a 9-hour
  error — because timezone inference existed in the routers and not the executor;
- importer-typed airports got no coordinates because Places lookup existed only
  in the executor.

**Rule now.** Every mutation of trip content goes through one service function
per operation (`services/trips.py`). Import uses the same functions editing will
use later. Routers adapt HTTP → service and contain no rules.

## 2. Don't store derived data — or give it exactly one writer

**What happened.** Check-in/check-out and departure/arrival *points* were stored
copies of stays and travel legs. The importer wrote a `"Depart ORD"` point *and*
the sync derived `"Departure: Flight from ORD…"` from the same leg — the timeline
showed both, each half complete.

**Rule now.** Stays live at trip level and are their own type with their own
rules. The timeline computes "check in / staying / check out" markers **at render
time**; nothing derived is stored.

## 3. Time: three different shapes, never conflated

**What happened.** Business times were stored as free strings (`+02:00`, `Z`,
or no offset, all at once). Some pages parsed with `dayjs(value)` (converting to
the browser's zone), others stripped offsets first — the same event showed
different clock times on different pages. Trips had no timezone, so code fell
back to `UTC`. The "a date-only check-in means 4pm" rule ran in one write path
only.

**Rule now** (matches the template's `UtcDateTime` / `WallClockTime` split):

| Shape | Example | Stored as |
|---|---|---|
| Plain date | trip start, day date | `DATE` — never converted across zones |
| Wall-clock | "flight departs 14:30" | naive local datetime **+ IANA zone** (`Europe/Zurich`) |
| Instant | `created_at`, ordering | UTC-aware (`UtcDateTime`) |

- The trip carries a **required** IANA timezone; items/stays may override it.
  There is no silent `UTC` fallback anywhere.
- One frontend formatting helper renders wall-clock values verbatim. Never call
  `dayjs(isoString)` on a wall-clock value.

## 4. Model stays as the booking, not as a check-in event

**What happened.** In the old `data/trip.json` every stay was a 30-minute window
(`checkIn 13:45`, `checkOut 14:15`) — the import modelled "the check-in moment",
not the booking. Every stay-coverage check built on top of that was meaningless.

**Rule now.** A stay is the whole booking: `checkIn` on the arrival date,
`checkOut` on the departure date, `checkOut > checkIn`, enforced at import.

## 5. At most one day per date

**What happened.** Three code paths created days (date-range reconciliation, the
point sync inventing a placeholder, and naming), none checked first → two
"July 25th"s.

**Rule now.** Unique `(trip_id, date)`; an import with a duplicate date is
rejected.

## 6. Import must never destroy data

**What happened.** Itinerary import was a full replace, guarded by a `status`
flag that not every write path maintained.

**Rule now.** Import **always creates a brand-new trip**. No update, merge or
diff. Ids inside an uploaded document are ignored and regenerated.

## 7. Validate at the boundary, reject loudly

The rebuild rejects a bad import outright (dates outside the trip, duplicate
days, end before start, unknown fields) with field-precise errors
(`days[3].items[1].start`). Relax later, deliberately, if needed.

## 8. PATCH: "absent" ≠ "explicitly null"

**What happened.** `model_dump(exclude_none=True)` dropped explicit `null`s, so
"remove that confirmation number" did nothing — and reported success.

**Rule now** (for when editing arrives): use `exclude_unset=True` /
`model_fields_set`; a no-op update must never report success.

## 9. One schema source of truth

**What happened.** A travel leg's shape was declared in six places across five
files (Pydantic schema, LLM contract, form registry, JSON schema, frontend
forms, serializers).

**Rule now.** The Pydantic `TripDocument` model is the source; the published
JSON Schema is *generated* from it, and a test fails if the committed
`schema/trip.schema.json` drifts.

## 10. Test against a real database

**What happened.** Most DB tests used hand-rolled fake sessions that ignored
`WHERE` clauses and couldn't populate relationships — they hid bugs and blocked
refactors. Postgres-only features (`num_nonnulls`, `NOW()`, `JSONB`, partial
indexes) made swapping in a real test DB hard.

**Rule now.** Tests use the template's real SQLite fixtures. Avoid
dialect-specific SQL in models.

## 11. Async SQLAlchemy gotcha: `MissingGreenlet`

A `server_default` column left unloaded after INSERT gets lazy-loaded the first
time Pydantic touches it — synchronously — which raises `MissingGreenlet` under
asyncio. Use `eager_defaults` and explicit eager loading (`selectinload`) when
assembling a trip; never rely on lazy loads.

## 12. Store intent, derive state

A stored `active` status and the clock are two sources of truth that drift.
v1 ended up deriving "is this trip underway?" from the dates on every read. Do
that from the start if/when it comes back.

## 13. Scope discipline

The chat assistant (16 tools, streaming, evals, idempotency…) consumed months
and a 45k-line branch that never merged, while the core timeline stayed rough.
The rebuild follows the template workflow: small crawl/walk/run phases, each
verified and merged. AI features stay out until the core is solid.

---

## Kept knowledge: trip verification (not ported yet)

Deliberately not rebuilt yet, but worth keeping. Source:
[`reference/legacy-docs/trip_verify.py`](../reference/legacy-docs/trip_verify.py),
test fixtures in [`reference/data/verify_cases/`](../reference/data/verify_cases/),
your original feature notes in `reference/legacy-docs/feature_notes.md`.

- **Two different questions.** *Verify* asks "is this trip sound?" and reports
  issues **by date**. *Gaps* asks "which record is missing which field?" and
  reports **by record** — that maps directly onto a form to fix it. v1 built both
  and they ended up overlapping (inspection page vs gaps banner). Decide up front
  which question a screen answers.
- **Gap tiers:** `blocking` (a flight with no departure time can't go on a
  timeline; a stay with no dates covers no nights) vs `worth_adding`
  (confirmation numbers, flight numbers). Keep the "worth adding" list short —
  a banner with nine items is a chore, not a nudge.
- **The 9 v1 issue codes:**

  | Code | Severity | Meaning |
  |---|---|---|
  | `INCOMPLETE_STAY` | error | stay missing check-in or check-out |
  | `STAY_OUTOFBOUNDS` | error | stay date before trip start / after trip end |
  | `STAY_OVERLAP` | error | check-in before the previous stay's check-out |
  | `MISSING_STAY` | warning | a trip night not covered by any stay |
  | `EMPTY_DAY` | warning | a date in range with no day or no plans |
  | `TRAVEL_INCOMPLETE_DATES` | error | leg missing departure or arrival time |
  | `TRAVEL_INCOMPLETE_LOCATIONS` | error | leg missing origin or destination |
  | `TRAVEL_OUTOFBOUNDS` | error | leg outside the trip dates |
  | `TRAVEL_OVERLAP` | error | departure before the previous arrival |

- **Bugs to not repeat:**
  - Coverage counted check-in..check-out **inclusive**. A stay covers *nights*:
    `checkIn.date ≤ night < checkOut.date`. (The last night of a trip usually
    has no stay — that's not a gap.)
  - Dates were derived by slicing the first 10 chars of a string, ignoring the
    zone. Compare in the event's own local date.
  - Overlap checks compared naive datetimes from different zones. Compare
    instants (local + IANA zone → UTC).
- **Known limitation:** verify caught *missing* data, never *impossible* data
  (a 20-minute gap between an activity in Shuri and a flight from Naha passed).
- **Several import-time rules in the rebuild cover what used to be verify errors**
  (out-of-bounds dates, end before start, duplicate days) — those are now
  unrepresentable rather than reported.
