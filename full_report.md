# PriPriTrip — Full Technical Report

*Written 2026-07-12. **Last checked 2026-07-13**, line by line against the code — after S1 (the single
domain layer, `services/trip_write.py`) and R8/R9/R11/R19 (frontend tests in CI, ruff + mypy, component
tests, one point serializer). §3.1 was rewritten: the executor is no longer the write path. Counts,
route totals and the service table were re-derived from the tree rather than trusted.*

*This is the "you know nothing about this project" document. It is not a quick-start; it is the map.
Where something is subtle or was got wrong once, it says so.*

---

## 1. What the app is

PriPriTrip is a **trip planner** for a couple or a small group. You give it the messy artefacts of
planning a trip — a sentence you typed, a booking email, a PDF itinerary — and it turns them into a
structured, timezone-correct timeline you can look at on your phone.

The product bet is stated plainly, because it drives most of the architecture:

> **Recording the plan must not be the expensive part of using the app.** If a traveller has to sit
> down and carefully type structured records, they won't. So every input path is designed to accept
> partial, vague, human input and turn it into real records without a fight.

That is why there is an AI chat assistant, a document importer, dynamic forms, a gap-filling banner,
and a location resolver that refuses to guess. They are all the same feature: *lower the cost of
telling the app what you know.*

**Stack:** FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL 16 on the backend; React 18 + Vite + MUI +
Redux Toolkit / RTK Query on the frontend; OpenAI for the assistant and document import; Google
Places for location data. The app is a PWA with an offline read cache.

**Current state:** local-only, no deployment. A trip has one owner, who can hand out read-only
share links (§11). A trip becomes **active** on its start date and swaps the timeline for a What's
Next screen (§12). Migrations are deliberately deferred — the database is recreated from `models.py`
rather than migrated, and there is no Alembic.

**Three test tiers**, all gating CI (§7):

| tier | count | against |
|---|---|---|
| pytest | **302** | a real throwaway PostgreSQL |
| frontend (vitest) | **88** (29 of them render React components) | jsdom |
| evals | **15 scenarios** | the *live* OpenAI API — the only tier that costs money |

Plus **ruff** and **mypy**, both clean and both blocking a merge.

---

## 2. Repository layout

```
PriPriTrip/
├── api/
│   ├── app/
│   │   ├── main.py               FastAPI app factory, CORS, router registration,
│   │   │                         and the one WriteError → HTTP status handler
│   │   ├── database.py           Engine, session factory, declarative Base
│   │   ├── models.py             All 10 SQLAlchemy models + soft-delete helpers
│   │   ├── schemas.py            Every Pydantic wire model (camelCase on the wire)
│   │   ├── enums.py              TripStatus, PointType, LocationRole, TravelMode, StayType
│   │   │                         + DERIVED_POINT_TYPES
│   │   ├── settings.py           Pydantic settings, read from .env
│   │   ├── auth.py               require_auth dependency
│   │   ├── users.py              fastapi-users wiring (JWT)
│   │   ├── dependencies.py       get_owned_trip / require_owned_trip
│   │   ├── routers/              HTTP layer — thin, no business logic
│   │   └── services/             All the actual logic — trip_write.py is the write path (§3.1)
│   ├── evals/                    The live-model prompt test harness (§6)
│   ├── tests/                    pytest, against a real Postgres (§7)
│   ├── sql/                      Hand-written DDL applied during development
│   ├── pyproject.toml            ruff + mypy config (there is no packaging here — this
│   │                             file exists only to configure the tools)
│   └── pripritrip_system_prompt.md   The assistant's system prompt (sectioned)
├── ui/
│   └── src/                      React app (§8)
├── .github/workflows/ci.yml      3 jobs: static (ruff+mypy), backend (pytest), frontend
├── review.md                     The standing code review — findings R1–R21, S1–S8
└── docs/                         This file, the design/plan docs, source PDFs
```

---

## 3. Architecture: the five rules

Almost every design decision in the backend follows from one of these. If you understand these, the
code stops being surprising.

### 3.1 `trip_write.py` is the single write path

Every mutation to trip content goes through **`services/trip_write.py`** — `create_stay`,
`update_travel`, `delete_point`, `create_day`, `update_trip` and their siblings. It owns *every*
domain rule: Google Places resolution, timezone inference, UTC derivation, the "a date-only check-in
means 4pm" normalisation, generated-point syncing, `promote_to_draft`, day adoption, the
derived-point guards, and the `model_fields_set` semantics that let an explicit `null` clear a column
while an absent key leaves it alone.

**Six callers adapt to it, and not one of them contains a rule:**

```
chat assistant ──► trip_action_executor.py ──┐
UI forms       ──► trip_points.py            │
               ──► trip_details.py           ├──► trip_write.py ──► DB
               ──► trip_days.py              │
structured     ──► trip_import.py            │
document       ──► trip_ai_import.py         ┘
```

> **This is recent, and it is the single most important thing to understand about the backend.**
> Until 2026-07-13 there were **two** write paths — the chat executor and the REST routers — each
> implementing the same rules independently. Every rule added to one and not the other gave the app a
> split personality, and **all three of the correctness bugs in `review.md` were instances of it**:
> a chat-built trip that an itinerary upload would silently delete; chat-created stays stamped `UTC`
> instead of the venue's timezone (a 9-hour error); an assistant that could not clear a field and
> reported success anyway. They are not patched — they are *unrepresentable*, because there is no
> longer a second place for a rule to be missing from.

Two divergences nobody had even noticed fell out of the merge: Places resolution ran only in the
executor (so airport codes typed into the new-trip wizard were stored with **no coordinates**), and
the 4pm check-in normalisation ran only in the routers (so *"check in on the 30th"* said to the
assistant landed at **midnight**).

`trip_write` refuses work by raising `WriteError` / `ConflictError`, which carry their own HTTP status.
One handler in `main.py` turns those into responses, so a refusal looks the same through every door —
while the executor catches them and hands them to the model as a tool result it can act on (§5.3).

The executor is now a **thin adapter**: 343 lines, mostly a per-target dispatch table plus the
model-specific plumbing (coercing invented ids, resolving date prose, turning refusals into tool
results). It was 739 lines.

### 3.2 The model may not invent facts it cannot know

The LLM contract is *narrowed on purpose*:

- It can supply a location's **name, role, description, link** — and nothing else. No latitude, no
  longitude, no Google Place ID, no formatted address. Models hallucinate those confidently. The
  backend looks them up itself via Google Places.
- It can supply a point's type only as `activity` — the schema is literally `{"const": "activity"}`.
- It cannot choose a form's field types or dropdown options. It names the record and the fields; the
  server builds the form from its own registry.

The pattern: **let the model do language, not data.**

### 3.3 Derived records have exactly one writer

Four of the five point types are *projections* of something else:

| point type | is really | 
|---|---|
| `check-in`, `check-out` | the stay's `check_in` / `check_out` times |
| `departure`, `arrival` | the travel leg's `departure` / `arrival` times |
| `activity` | a thing you chose to do — the only *authored* type |

`services/detail_points.py` materializes those four from their parent and is the **only** code
allowed to. `app/enums.py::DERIVED_POINT_TYPES` names them. The model, the importer, the REST router
and the UI are all refused if they try.

This was learned the hard way. The importer used to write its own `"Depart ORD"` point *and*
`detail_points` derived a `"Departure: Flight from ORD…"` from the same leg. You got both on the
timeline, and neither was complete — the derived one had the travel link but no location, the
hand-written one had the airport but no link. Generated points now **inherit their parent's place**
(departure ← origin, arrival ← destination, check-in/out ← venue), rebuilt on every sync so they
cannot drift.

### 3.4 A date has at most one primary day

Three different things create days: `reconcile_trip_days` (one per date in the trip's range), the
generated-point sync (a flight has to land on *some* day, so it invents a placeholder titled
`"2026-07-25"`), and whoever names it later. None of them used to look first, so saving a flight and
then naming its day gave you two July 25ths.

Now everything goes through **`detail_points.py::primary_day_for_date`**, `create_day` on an occupied
date **renames** the day that's there and returns its id, and a partial unique index
(`uq_trip_days_one_primary_per_date`) holds the line in the database. *Alternate* days are exempt —
`is_alternate=True` means "a second, competing plan for this date", which is a real feature.

### 3.5 Time is stored three times, on purpose

Every timestamp on a stay, travel leg or point is three columns:

```
departure_local   TIMESTAMP WITHOUT TIME ZONE   -- the wall clock. What the ticket says. "14:30"
departure_tzid    VARCHAR                        -- which clock. "Asia/Tokyo"
departure_utc     TIMESTAMP WITH TIME ZONE       -- the derived instant, for ordering & comparison
```

A flight departs at "14:30" — that is a fact about a clock on a wall in a specific place, not an
instant. Store only the instant and you cannot render the ticket; store only the wall clock and you
cannot sort a trip that crosses timezones. `services/timezones.py` derives `_utc` from
`_local + _tzid`, and the timezone itself is inferred from the location's coordinates when the user
doesn't say. Pure dates (`trip.start_date`, `day.date`) are real `DATE` columns with no time at all.

---

## 4. Backend

### 4.1 Database models

All in `app/models.py`. Ten tables.

| Model | Table | What it is |
|---|---|---|
| `UserRecord` | `users` | A person: fastapi-users' auth columns plus name, phone, and a home location (name, address, coords, place id, timezone) used to give the assistant a default context. |
| `TripRecord` | `trips` | One trip: name, `status`, start/end dates, start & destination location *names* (free text, not resolved places), default timezone. |
| `TripDayRecord` | `trip_days` | One calendar day of a trip — the timeline's top-level grouping; `is_alternate` marks a competing plan for the same date. |
| `TripPointRecord` | `trip_points` | One thing that happens at a time: an activity you authored, or a check-in/departure the backend derived from a stay or travel leg (`is_system_created`). |
| `StayDetailRecord` | `stay_details` | One accommodation booking spanning multiple nights: name, type, check-in/out, room type, confirmation number. |
| `TravelDetailRecord` | `travel_details` | One journey leg — flight, train, drive: mode, operator, vehicle number, cabin class, departure/arrival. |
| `LocationRecord` | `locations` | A place, owned by *exactly one* of a point, stay, or travel (enforced by a `num_nonnulls(...) = 1` check constraint); carries the Google-resolved address, coordinates, place id and timezone. |
| `AIDocumentRecord` | `ai_documents` | An uploaded itinerary/booking document: its extracted text, the AI's structured extraction, and the resulting import payload — kept so an import can be reviewed and re-run without re-uploading. |
| `TripShareRecord` | `trip_shares` | A read-only share link: an unguessable token, whether it's been revoked or expired, and how many times it's been opened. At most one live link per trip (partial unique index). |
| `ChatMessageRecord` | `chat_messages` | One turn of a chat, user or bot; the bot row also stores `structure_content` (actions taken, the `uiPayload`) and `reply_payload` (the exact response, for idempotent replay). |

**Trip status.** `TripRecord.status` stores *intent*, not the current reality, and it does two jobs:

| stored | means | consequences |
|---|---|---|
| `new` | no content yet | An itinerary import is allowed. Never active. |
| `draft` | has content | Itinerary import is **locked** — it is a full replace and would delete everything. Goes active automatically while the trip is underway. |
| `active` | forced on by hand | Active regardless of the dates (you arrived early). |

Two things follow, and both have bitten:

- **Anything that gives a trip content must promote it** `new → draft`, or an itinerary upload will
  silently wipe a trip you built by hand. That is `promote_to_draft()` in `trip_state.py` — the
  *only* writer of the column (five raw `status = "draft"` assignments used to exist, every one of
  which would have demoted an `active` trip mid-flight). Since S1 it is called from `trip_write.py`,
  so **every** door promotes: chat, form, importer and REST alike. It used to be called from the
  routers only, which is exactly how a chat-built trip stayed `new` and stayed wipeable.
- **"Active" is never stored by the automatic rule.** It is derived from the dates on read
  (`trip_status.py`), because a persisted `active` and a clock are two sources of truth that drift.
  See §12.

**Soft delete.** Most models carry `SoftDeleteMixin` (`is_deleted` + `deleted_at`). A row is only
"deleted" when **both** agree — use the `active(Model)` / `deleted(Model)` helpers rather than
writing the filter yourself. `LocationRecord` is the exception: it has no soft delete, because it
dies with its owner (`ON DELETE CASCADE`).

**Relationships bake in the soft-delete filter.** `TripRecord.days`, `.stays`, `.travels` and
`TripDayRecord.points` are `viewonly` relationships whose `primaryjoin` already excludes deleted
rows, so a caller *cannot forget* the filter. Writes still go through `trip_write` explicitly.

**Indexes.** Every FK that gets filtered on is indexed (Postgres does not do this for you), plus
partial indexes on `NOT is_deleted` for the hot paths.

**`eager_defaults`.** The declarative `Base` sets `__mapper_args__ = {"eager_defaults": True}`. This
matters: `created_at` is a `server_default` (`NOW()`), and without eager defaults SQLAlchemy leaves it
*unloaded* after INSERT and fetches it lazily on first touch. That touch is usually Pydantic, which
is synchronous — and a lazy load from sync code under asyncio raises `MissingGreenlet`. It bites
whenever one session both inserts a row and renders it, which is exactly what a chat turn does when
the model changes the trip's dates.

### 4.2 The service layer

`app/routers/*` are thin: auth, ownership, deserialize, call a service, serialize. Everything real is
in `app/services/`.

| Service | Responsibility |
|---|---|
| `trip_write.py` | **The single write path (§3.1).** The only place trip content is written, by anyone. Owns Places resolution, timezone inference, UTC derivation, wall-clock normalisation, generated-point syncing, `promote_to_draft`, day adoption and the derived-point guards. Refuses with `WriteError` / `ConflictError`, which carry their own HTTP status. |
| `trip_action_executor.py` | **The assistant's adapter onto `trip_write`** — *not* a write path of its own. Turns an `AssistantAction` (`{op, target, id, fields}`) into a `trip_write` call via a per-target dispatch table, and turns the result — including a refusal — into an `ActionResult` the model can read and act on. Also does the model-specific plumbing: invented ids, date prose. |
| `detail_points.py` | The **only** writer of derived points. Syncs check-in/out & departure/arrival points from their parent stay/travel, mirrors the parent's locations onto them, reconciles a trip's day rows against its date range, and owns `primary_day_for_date`. |
| `chat_tool_loop.py` | The agent loop: builds the prompt, streams completions, dispatches tool calls, feeds results back, caps iterations, and emits the final `WorkflowOutcome`. |
| `chat_tools.py` | The 16 tools: per-tool camelCase Pydantic argument models, handlers, and the OpenAI JSON schema. Also turns location decisions into guidance for the model. |
| `chat_forms.py` | The server-owned form registry (`FIELD_SPECS`): what fields exist per target, their labels, types and options. Builds forms and re-validates submissions. |
| `chat_choices.py` | Turns an ambiguous location into a tappable `choice` card, and applies the user's pick (or a place they searched for themselves). |
| `location_resolver.py` | Google Places lookup + the **confidence rule** (§5.6). Also `apply_resolution`, which writes resolved metadata onto a location dict. |
| `trip_state.py` | `assembled_trip` (the one relationship-based loader for the whole trip), `trip_summary` (the compact version the model sees every turn), and the new-trip completion rule. |
| `trip_verify.py` | Deterministic, offline soundness check — no OpenAI. Emits 9 issue codes: `INCOMPLETE_STAY`, `MISSING_STAY`, `EMPTY_DAY`, `STAY_OVERLAP`, `STAY_OUTOFBOUNDS`, `TRAVEL_INCOMPLETE_DATES`, `TRAVEL_INCOMPLETE_LOCATIONS`, `TRAVEL_OVERLAP`, `TRAVEL_OUTOFBOUNDS`. |
| `trip_gaps.py` | *Which record is missing which field* — a different question from verify. Splits gaps into `blocking` (a flight with no departure time can't go on a timeline) and `worth_adding` (confirmation numbers). |
| `trip_ai.py` | Document import: a two-pass OpenAI pipeline (`structure_itinerary` → `enhance_trip`) that turns raw document text into a `TripImport`. |
| `document_ingest.py` | Extracts plain text/markdown from an uploaded PDF/XLSX before the AI sees it. |
| `timezones.py` | `parse_wall_clock`, `derive_utc`, `tzid_from_coords`, `infer_tzid_from_locations`. The three-column time model (§3.5) lives here. |
| `date_normalizer.py` | Turns "Oct 30" / "next Friday" into an ISO date, using the app's current date and the trip's range as context. |
| `llm_contract.py` | The wire types shared by the model and the executor: `AssistantAction`, `AssistantActionFields`, `ActionResult`, `ActionLocationFields`, `LocationDecision`. camelCase-native. |
| `prompt_composer.py` | Loads `pripritrip_system_prompt.md`, splits it on `## [section]` markers, validates the required ones exist, and assembles the system prompt. Cached. |
| `openai_client.py` | Shared async OpenAI client + model name from settings. |
| `ai_trace.py` | Structured JSONL logging of every AI event to `ai.log` (rotating). This is how the pipeline is debugged and how token/cache usage was measured. |
| `trip_share.py` | Share links: mint, revoke, and the one function (`resolve_share_token`) that decides whether a link is live — so "is this still valid?" has exactly one answer. |
| `trip_status.py` | **When is a trip active?** Derived from the dates on every read, never stored — persist it and the column and the clock become two sources of truth that drift. |
| `locations.py` | Shared `LocationRecord` row construction. |

### 4.3 API surface

```
Auth        POST   /auth/session, /auth/register/session, /auth/login, /auth/register, /auth/logout
Profile     GET|PUT|DELETE /profile, POST /profile/timezone
Trips       GET  /trips
            GET|PUT|DELETE /trips/{id}
            PATCH /trips/{id}/status              (planning ⇄ on this trip — §12)
            GET  /trips/{id}/verify
Days        GET|POST /trips/{id}/days, PATCH|DELETE /trips/{id}/days/{day_id}
            GET  /trips/{id}/days/deleted, POST .../restore
Points      GET|POST /trips/{id}/points, PATCH|DELETE /trips/{id}/points/{point_id}
            GET  /trips/{id}/points/deleted, POST .../restore
Details     GET|POST /trips/{id}/stay-details,   GET|PATCH|DELETE .../{stay_detail_id}
            GET|POST /trips/{id}/travel-details, GET|PATCH|DELETE .../{travel_detail_id}
Import      POST /trips/{id}/import              (structured payload → rows)
            POST /trips/{id}/ai-import, /trips/ai-import   (itinerary → TripImport)
            POST /trips/{id}/ai-documents        (confirmation → stay/travel records)
            POST /ai-documents/{id}/save         (persist those records)
            POST /trips/ai-enhance               (exists, not wired to anything)
Chat        POST /chat/reply           (SSE)
            GET  /chat/trips/{id}
            POST /chat/forms/submit
            POST /chat/choices/submit
Gaps        GET  /trips/{id}/gaps
            POST /trips/{id}/gaps/submit
Share       POST|GET|DELETE /trips/{id}/share      (owner: mint / read / revoke)
            GET  /shared/{token}                   ** no auth **
Health      GET  /health                           ** no auth **
```

**There is no `POST /trips`.** A trip is created by `PUT /trips/{id}` with a client-generated UUID
(the wizard and the chat both mint one), which is also how a trip is updated. Worth knowing before you
go looking for the create endpoint.

`GET /shared/{token}` is the **only unauthenticated endpoint in the app that returns user data**. It
never reads the `Authorization` header, returns its own `SharedTripResponse` schema (so a field added
to the owner's trip view can't silently start leaking), and 404s identically for unknown, revoked and
expired tokens — a 403 would confirm the token had once existed. See §11.

`GET /trips/{id}` returns the whole assembled trip (days → points → locations, plus stays and travels
with their locations) in a **flat number of queries** — at most 8 SELECTs regardless of trip size,
pinned by `tests/test_query_counts.py`.

### 4.4 Authentication

**fastapi-users**, wired in `app/users.py`: a `BearerTransport` (the `Authorization` header) over a
`JWTStrategy` (a signed token, **stateless** — nothing is stored server-side). Passwords are bcrypt;
`manager.authenticate()` runs a dummy hash on an unknown email so an attacker can't distinguish "no
such user" from "wrong password" by timing.

Every authenticated route in the app depends on **`require_auth`** (`app/auth.py`) — all **47** of
them, none reaching past it to fastapi-users' `current_active_user` directly. Most get there through
`get_owned_trip`, which depends on `require_auth` and then does the ownership check, so a handler
cannot accidentally authenticate without also authorising. That single choke point is what makes the
whole thing testable: overriding one key in `app.dependency_overrides` covers the entire app.

**Exactly 7 routes are unauthenticated**, and they are the ones you would expect: `/health`, the five
`/auth/*` entry points, and `GET /shared/{token}` — the only one of them that returns user data (§11).

Two consequences of *stateless* that are easy to miss:

- **`POST /auth/logout` does nothing.** The strategy has no token to destroy; the route returns
  success and the token stays valid. Logging out is the browser deleting it from `localStorage`.
- **The token lifetime is therefore the blast radius of a leak.** It is 7 days.

There is no email-verification flow, so every account is marked verified in `on_after_register` —
*after* creation, because both registration routes call `create(safe=True)` and `safe=True` strips
`is_verified` (along with `is_active`/`is_superuser`) precisely so a stranger POSTing to
`/auth/register` cannot promote themselves.

Full analysis, including what is still wrong, in **`docs/auth_test_analysis.md`**.

---

## 5. The AI chat pipeline

This is the heart of the app. Read this section slowly.

### 5.1 Shape

It is a **tool-calling agent loop**, not a prompt-and-parse. There used to be a second "batch" mode
that asked the model for a JSON blob of actions; it was deleted. There is exactly one chat path now.

```
                  ┌─────────────────────────────────────────────────┐
  user message ──▶│  POST /chat/reply   (routers/chat.py)           │
                  │   · ownership check                             │
                  │   · idempotency claim (requestId)               │
                  │   · persist user message                        │
                  │   · build transcript window + rolling summary   │
                  └───────────────────┬─────────────────────────────┘
                                      ▼  (Server-Sent Events open here)
                  ┌─────────────────────────────────────────────────┐
                  │  stream_chat_tool_loop (chat_tool_loop.py)      │
                  │                                                 │
                  │   system prompt  ◀── prompt_composer            │
                  │   context msg    ◀── trip_summary + verify_trip │
                  │                                                 │
                  │   ┌───────────── loop, max 6 ──────────────┐    │
                  │   │  stream a completion                   │    │
                  │   │    · content chunks ──▶ SSE "delta"    │    │
                  │   │    · tool calls?                       │    │
                  │   │        yes ─▶ SSE "status"             │    │
                  │   │               dispatch (chat_tools)    │    │
                  │   │               ──▶ execute_action       │    │
                  │   │                   ──▶ trip_write       │    │
                  │   │               result back as tool msg  │    │
                  │   │               loop again               │    │
                  │   │        no  ─▶ this is the final answer │    │
                  │   └────────────────────────────────────────┘    │
                  └───────────────────┬─────────────────────────────┘
                                      ▼
                  ┌─────────────────────────────────────────────────┐
                  │  persist bot message + structuredContent        │
                  │  store reply_payload for replay                 │
                  │  COMMIT                                         │
                  │  SSE "done" { messages, verify, complete }      │
                  └─────────────────────────────────────────────────┘
```

Four SSE event types reach the browser: **`status`** (a tool is running — "Adding a stay…"),
**`delta`** (a chunk of the assistant's prose), **`done`** (the full reply payload), **`error`**.

### 5.2 What the model is given, every turn

Two messages.

**A system prompt**, assembled by `prompt_composer.py` from `pripritrip_system_prompt.md`. That file
is split on `## [section]` markers; the tool loop uses `[base]` + `[stage:assistant_tools]`. (It used
to have per-stage sections for a welcome/travel/stay state machine. That machine is gone — replaced
by the deterministic checklist below — and the sections went with it.) The prompt covers: the data
model, the date policy, the location policy, the day policy, tool-usage rules, and tone.

**A context message**, built by `_build_context_message`, containing:

1. **Runtime context** — `appCurrentDate` (today, in the *user's home timezone*), the user's home
   location, and UI context. Relative dates ("next Friday") are resolved against this.
2. **A compact trip summary** (`trip_summary`) — counts and top-level fields, not the whole itinerary.
   The model calls `get_trip_snapshot` when it needs detail. This keeps the per-turn prompt small.
3. **The verify checklist** (`verify_trip` output) — a *deterministic* list of what's missing. This is
   what replaced the stage machine: rather than a state machine deciding "we are in the stay stage, so
   ask about hotels", the model is simply told what's missing and left to be intelligent about it.
4. **The rolling conversation summary** of turns older than the window.
5. **The transcript window** — the last 12 turns.
6. **The latest user message.**

### 5.3 The 16 tools

| Tool | What it does |
|---|---|
| `update_trip` | Change top-level trip fields (name, status, start/destination names, dates, timezone). |
| `create_day` | **Names** a date — every date in range already has a day, so this renames it and returns its id. |
| `update_day` / `delete_day` | Edit or remove a day by id. |
| `create_point` | Add an **activity** (dinner, museum). Cannot create check-in/departure points — those are derived. |
| `update_point` / `delete_point` | Edit or remove a point; refuses structural edits to generated points and names the parent to edit instead. |
| `create_stay` | Create an accommodation booking; partial detail is fine and expected. |
| `update_stay` / `delete_stay` | Edit or remove a stay. |
| `create_travel` | Create a journey leg (flight/train/car/…); partial detail is fine. |
| `update_travel` / `delete_travel` | Edit or remove a travel leg. |
| `resolve_location` | Look a place name up and get back candidates + a **confidence** + **guidance**. |
| `get_trip_snapshot` | Fetch the full assembled trip JSON — used on demand rather than shipped every turn. |
| `request_form` | Put a small form on screen. The model names the target and the fields; the **server** decides types, labels, options and current values. |

Every mutating tool converts its arguments into an `AssistantAction` and runs `execute_action`, which
adapts it onto `trip_write` (§3.1) — the same function the UI's own forms call. The `ActionResult` —
including its errors — is returned to the model as the tool result. **That
is the feedback loop:** the model sees its own failures inside the turn and corrects them. The error
messages are written for that audience; they always name what to do instead. For example:

> `'Departure: Flight from ORD' is generated from its travel leg and is rebuilt whenever that travel
> leg changes, so the edit would be undone. Update the travel leg (a1b2…) instead — its times,
> confirmation number and locations are what this point shows.`

### 5.4 The loop, precisely

`_MAX_TOOL_ITERATIONS = 6`. Each iteration streams one completion. If it contains tool calls, they are
all dispatched (each emitting a `status` event first), their results appended as `role: "tool"`
messages, and the loop goes round. If it contains no tool calls, its content **is** the final answer
and the loop breaks.

If the cap is hit, the loop makes one final call **with no tools attached** and a nudge to "wrap up:
summarize what you did and what's still needed". This guarantees a turn always ends with an honest
message rather than an abandoned tool call. `capHit` is recorded and asserted `false` by every eval.

### 5.5 `uiPayload` — how the assistant hands you a widget

A bot message's `structure_content` can carry a `uiPayload` of `kind: "form"` or `kind: "choice"`. The
frontend renders it under the message bubble. Both are answered by endpoints that **make no model
call at all** — they go straight through the write layer:

- **`POST /chat/forms/submit`** — a filled `request_form`. The submitted values are re-validated
  against the server's `FIELD_SPECS` registry (the form came from us, but the submission comes from a
  client) and applied. ~75ms instead of a 4–8s chat turn.
- **`POST /chat/choices/submit`** — the user picked a place. Either an `optionId` we offered (checked
  against the choice we actually issued and stored with the message) or a `placeId` they found through
  the card's own Places autocomplete. Measured at ~220–290ms in the browser.

### 5.6 Location resolution and the confidence rule

This is the most subtle piece. `services/location_resolver.py`.

The model supplies only a place *name*. Every write passes through Google Places Text Search, biased
by the trip's destination (`_bias_query` appends "Okinawa" to "the Hyatt" — unless the user already
said where). Google returns a ranked list but **no confidence score**, so we compute one.

```python
TOP_MATCH_MIN = 0.72   # how well the best candidate's name must match what the user said
LEAD_MIN      = 0.15   # how far ahead of the runner-up it must be
_NOISE_WORDS  = {"the", "a", "an", "at", "in", "hotel", "airport"}
```

`_normalize()` strips case, accents, punctuation and noise words. `similarity()` is a
`difflib.SequenceMatcher` ratio between the normalized *original query* and the normalized candidate
name. `classify()` then returns one of three confidences:

| confidence | when | what happens |
|---|---|---|
| **high** | one candidate came back at all, **or** the top scores ≥ 0.72 *and* beats the runner-up by ≥ 0.15 | The place is applied, and the model is told what it assumed so it can say so out loud. |
| **medium** | several plausible candidates, no clear winner | **Nothing is applied.** The raw name is kept, and the user gets a `choice` card carrying the place IDs *we* looked up. The model is explicitly told **not** to also ask which one they meant. |
| **low** | nothing found | The raw name is kept; the model asks for something more specific. |

**The honest caveat, because it is not what the constants suggest.** Measured scores:

| user said | candidate | score |
|---|---|---|
| "Naha airport" | Naha Airport | 1.00 |
| "Ritz Carlton Kyoto" | The Ritz-Carlton, Kyoto | 1.00 |
| "the Sheraton" | Sheraton Okinawa Sunmarina Resort | **0.39** |
| "the Hyatt" | Hyatt Regency Naha, Okinawa | **0.32** |

`SequenceMatcher` compares whole strings, so a short query against a long official name scores low
even when it is a perfect prefix. The 0.72 bar therefore only clears when the user was already
specific — which is exactly when we're entitled to pick for them. **The branch that fires most often
is the single-candidate one**: "the Sheraton" on an Okinawa trip resolves outright at a score of 0.39
because there is only one Sheraton in Okinawa. Two Hyatts, both scoring ~0.3, is a choice.

These numbers are tuned judgement, not derived. They are named constants precisely so they can move.

### 5.7 Idempotency

The client stamps every send with a `requestId` (required — a request without one is a 422). Both rows
of the turn carry it, and a unique constraint on `(user_id, request_id, is_bot)` is what actually
blocks a double-send: a concurrent duplicate **blocks on the constraint** until the first transaction
ends, then fails — so the LLM pipeline runs exactly once even for simultaneous sends. The bot row
stores the exact `ChatReplyResponse` it produced in `reply_payload`, so a repeat replays it verbatim.

On failure the turn is rolled back **explicitly** — including the user message and its request-id
claim, so the same id can be retried. (This was found by moving the tests onto a real database: the
code had been relying on session teardown to discard a failed turn, which the fake session had made
invisible.)

### 5.8 Observability

`ai_trace.py` writes structured JSONL to `ai.log` (rotating): `chat.reply.received`,
`ai.chat_loop.start`, `.request`, `.tool_call`, `.tool_result`, `.final`, `.outcome`,
`chat.reply.outcome`, plus token counts and **cached prompt tokens**. This is not decoration — it is
how two sequencing decisions were settled with data rather than opinion (prompt caching turned out to
already hit 44% of calls at 91% of the prompt, which made a planned optimization pointless; and the
longest conversation ever recorded was 5 messages, which made LLM-based summarization premature).

---

## 6. The eval harness — prompt/behaviour testing

**`api/evals/`. This is a different thing from pytest and it is worth understanding why.**

### 6.1 What it is for

pytest tests *code*. The eval harness tests **the model's behaviour** — the things that are not
determined by the code at all, but by the prompt, the tool descriptions, and the model's judgement.

You cannot unit-test "when the user says *'actually we're going to Tokyo'*, the assistant updates the
trip rather than ignoring it." There is no function to call. The only way to know is to run a real
message through a real model against a real database and assert on what happened.

That is exactly what this does: **it runs the genuine `chat_tool_loop` against the live OpenAI API,
against a real throwaway Postgres, and asserts on the structural consequences.**

### 6.2 The cardinal rule: never assert on wording

Every check is **structural**: which tools were called, which actions were persisted, what the trip
looks like afterwards, whether a `uiPayload` was attached. The two message-level checks
(`finalMessageMatches` / `finalMessageNotMatches`) are regexes used almost entirely in the *negative*
— to assert the assistant **didn't** ask a question it already knew the answer to.

Asserting the model's prose would make the suite a brittle snapshot test of a non-deterministic
system. Asserting its *effects* makes it a real behavioural contract.

> **One scenario breaks this rule, and it is the one that flakes.** `partial-capture-flight` asserts
> `finalMessageMatches: "\\?"` — a **literal question mark** — to check the assistant follows up on a
> half-captured flight. On 2026-07-13 it failed a full-suite run because the model had answered *"If
> you want, I can add when you arrive…"*: the right behaviour, phrased as an offer rather than a
> question. It then passed 4/4 in isolation and 15/15 on a re-run.
>
> This is the exact brittleness the rule exists to prevent, and it should be rewritten to assert the
> structural consequence (the travel leg exists but is incomplete; `complete=false`) rather than the
> punctuation. Logged in `review.md`'s roadmap. **If you are chasing a 14/15, check this one first.**

### 6.3 Anatomy

| File | Role |
|---|---|
| `scenarios/*.json` | One scenario per file: seed state, the message to send, and the checks. |
| `scenario.py` | Pydantic schema for a scenario + the loader. `extra="forbid"`, so a typo in a check name is an error, not a silently-ignored assertion. |
| `db.py` | Creates and drops a throwaway `pripritrip_evals` database. **Asserts it is not the dev database.** Each scenario gets a transaction that is rolled back afterwards, so nothing accumulates. |
| `runner.py` | Seeds the trip, runs the real `run_chat_tool_loop`, scores the checks. |
| `checks.py` | The assertions (below). |
| `__main__.py` | The CLI. |
| `mock_client.py` | A stub OpenAI client, used by `tests/test_eval_harness.py` to test the *harness itself* without spending money. |

**Seeding is deliberately faithful.** `seed_trip` calls `reconcile_trip_days`, because in production a
trip with dates *always* has its day rows. The harness previously seeded a dated trip with **no** days
— a world the app never actually produces — and that unreality is precisely what hid the duplicate-day
bug. Making the fixture honest surfaced it immediately.

### 6.4 The checks available

| Check | Asserts |
|---|---|
| `toolsCalledInclude` / `toolsCalledExclude` | These tools were / were not called. |
| `persistedInclude` | At least one action of this `op`+`target` was actually persisted, with these field values. (Persisted, not *attempted* — an action the executor rejected doesn't count.) |
| `locationsInclude` | A location matching this regex exists on the trip, and (optionally) is/isn't `resolved` (has a Google place id). |
| `uiPayloadKind` | The assistant attached a `choice`, a `form`, or nothing. |
| `countsMin` / `countsMax` | Live row counts on the trip: `days`, `points`, `stays`, `travels`. Real `COUNT(*)`s, not dict lengths. |
| `tripFieldEquals` | A `TripRecord` column equals this value. |
| `finalMessageMatches` / `finalMessageNotMatches` | Case-insensitive regex on the assistant's prose. |
| `maxIterations`, `capHit`, `complete` | Loop shape and the new-trip completion flag. |

### 6.5 The 15 scenarios, and what each one guards

**Natural capture — the core product bet**

| Scenario | Message | Guards |
|---|---|---|
| `new-trip-full-capture` | *"We're going to Portland, Oregon October 17-19 2026 — driving down from Seattle on the 17th, staying at the Ace Hotel downtown, and driving back on the 19th."* | The whole premise: one rich sentence on an empty trip must capture dates, destination, travel **and** stay in a single turn. If this breaks, the app's reason to exist breaks. |
| `partial-capture-flight` | *"I'm flying into Naha airport."* | Half a fact is still a fact. Must **create the travel record immediately** rather than chatting about it and waiting for a complete set of details. |
| `partial-capture-stay` | *"We're staying at the Hyatt in Kyoto."* | Same, for stays — and must infer `stayType=hotel` rather than leaving it blank. |

**Not being annoying**

| Scenario | Message | Guards |
|---|---|---|
| `no-repeat-destination` | *"I'm flying into Naha airport."* (destination already Okinawa) | Must not ask "where are you going?" — it can see the trip state. |
| `no-repeat-start-date` | *"We want to stay somewhere near the beach."* (dates already set) | An unrelated detail must not re-trigger a date question. |
| `snapshot-read-only` | *"What does my trip look like so far?"* | A read is a read. **No mutating tool may run.** Excludes all 12 write tools. |

**Not destroying things**

| Scenario | Message | Guards |
|---|---|---|
| `no-unprompted-deletes` | *"The whole trip moved — now it's Nov 5 through Nov 11."* | Moving the dates must **not** delete the existing stay and travel. Deletions require clear intent. |
| `conflict-destination-correction` | *"Actually we're going to Tokyo, not Okinawa."* | A correction is a correction — update the trip. Don't ignore it, don't create a second trip. |
| `conflict-arrival-update-not-duplicate` | *"Small change — we arrive Oct 31 instead of Oct 30."* | Must **update** the existing flight, not create a second one. `countsMax: {travels: 1}`. |

**Dates**

| Scenario | Message | Guards |
|---|---|---|
| `date-next-occurrence` | *"We fly out Oct 30 and get back Nov 5."* (app date 2026-07-09) | A bare "Oct 30" resolves to **2026**-10-30 — the next occurrence. |
| `date-rolls-to-next-year` | *"The trip starts Jan 1 and ends Jan 8."* (app date 2026-07-09) | A bare "Jan 1" must roll **forward** to 2027-01-01, not backwards into the past. |

**The uiPayload contract**

| Scenario | Message | Guards |
|---|---|---|
| `location-ambiguous-offers-choice` | *"We're staying at the Hyatt."* | The full 3F-5 contract: the stay is saved anyway; a **location is attached**; it is left **unresolved** (no silent guess); a **choice card is offered**; and the assistant does **not** also ask "which Hyatt?" in prose. |
| `form-for-booking-details` | *"I have my flight booking email in front of me — where do I put the airline, flight number and confirmation code?"* | Several fiddly values on one record → hand over a **form**, don't interrogate the user in prose. |

**Structural invariants (added after real bugs)**

| Scenario | Message | Guards |
|---|---|---|
| `flight-makes-one-departure-not-two` | *"I fly out of O'Hare at 9am on Oct 30 and land at Naha airport at 2:30pm."* | The model must create **only** a travel leg (`toolsCalledExclude: [create_point]`). Exactly 2 points result — the generated departure and arrival — and both airports are attached. This is the duplicate-points bug, pinned. |
| `flight-makes-one-day-not-two` | *"I fly into Houston on July 25th at 4pm, landing 6:30pm. Call that day 'Arrival in Houston'."* | Naming a date that already has a day must **rename** it, not add a second. A 4-day trip stays at 4 days. This is the duplicate-days bug, pinned. |

### 6.6 Running it

```bash
cd api
python -m evals                          # every scenario once, live
python -m evals --list                   # names + descriptions
python -m evals --scenario location      # substring filter
python -m evals --runs 5                 # 5x each — the way to check flakiness
python -m evals --runs 3 --threshold 0.67
python -m evals --verbose                # show every tool call and final message
python -m evals --json report.json
```

It needs `OPENAI_API_KEY` in `api/.env` and the Postgres container up. It costs real money (~50s and
a few cents for the full suite).

### 6.7 What it has actually caught

This is not a theoretical suite. Concretely:

- The `location-ambiguous-offers-choice` scenario **passed while the model was attaching no location
  at all** — it only asserted the *stay* was created. Tightening it with `locationsInclude` +
  `uiPayloadKind` turned it into a real test, and it immediately caught the prompt gap.
- Adding a "named venues must go in `locations`" rule to the prompt made the model start **dropping
  `stayType`**. `partial-capture-stay` failed 2 out of 2 full-suite runs (while passing 5/5 in
  isolation — the failure mode was real, not random). That is a regression I introduced and the suite
  caught, and it was fixed by improving the `create_stay` tool description.
- Making the harness seed days realistically surfaced a **`MissingGreenlet` crash on the live chat
  path** (§4.1, `eager_defaults`) that no test had ever hit.

**Known flakiness:** the model is non-deterministic and the default `--threshold 1.0` with `--runs 1`
means one unlucky run fails the suite. Roughly one run in six comes back 14/15. **Before blaming your
change, re-run** — and check whether the failure is `partial-capture-flight`, whose question-mark
assertion (§6.2) is the known-brittle one rather than a real signal.

The honest procedure for judging a change: `--runs 3` or more, and if something fails, run *that*
scenario in isolation. A failure that reproduces in isolation is real (that is how the dropped
`stayType` regression was confirmed); one that doesn't is usually the model choosing different
wording.

---

## 7. The pytest suite (for contrast)

**302 tests**, all against a **real, throwaway PostgreSQL database** (`pripritrip_test`, recreated per
session; `conftest.py` asserts it will never point at the dev DB). Each test runs in a transaction +
savepoint that is rolled back, so tests don't accumulate state.

Moving off fake sessions was itself valuable — it immediately exposed two real bugs (the chat
rollback, and a fixture whose user row was being erased by an endpoint's rollback).

| File | Tests | Covers |
|---|---|---|
| `test_location_choice.py` | 23 | The confidence rule, the write layer no longer guessing, `apply_choice` security (an option we never offered is rejected; a location on another trip is rejected; a *searched* place is accepted but still can't cross trips). |
| `test_chat_forms.py` | 21 | The form registry, form building, and submission re-validation. |
| `test_auth.py` | 20 | Session/register endpoints, driven with a *fake* UserManager — routing and error mapping. |
| `test_trip_status_auto.py` | 19 | A trip goes active on its start date and back afterwards, derived not stored; the trip's own midnight is the boundary; content promotes a trip out of `new` (or an itinerary import would wipe it). |
| `test_trip.py` | 19 | Trip CRUD, ownership. |
| `test_trip_write.py` | **17** | **The domain layer (§3.1).** Pins the three bugs the split write paths caused — and, crucially, drives the *same* scenario through **both doors** (the chat executor *and* HTTP) and compares the resulting rows. If the two ever diverge again, this is what says so. |
| `test_action_ids.py` | 17 | The executor's id handling (invented ids are rejected/regenerated, and the model is told). |
| `test_trip_share.py` | 16 | Share links: revoked/expired/unknown tokens are indistinguishable 404s, the payload leaks nothing about the owner, another user can't share your trip, and a link grants no write anywhere. |
| `test_trip_days.py` | 15 | Day CRUD, soft delete, restore. |
| `test_chat.py` | 13 | `/chat/reply`: SSE, idempotency, replay, failure rollback. |
| `test_trip_verify.py` | 12 | All 9 verify issue codes. |
| `test_trip_details.py` | 12 | Stay/travel CRUD. |
| `test_trip_status.py` | 11 | `PATCH /status`; `promote_to_draft` never demotes an active trip; `startUtc` is serialised. |
| `test_eval_harness.py` | 11 | **The eval harness itself**, using the mock OpenAI client. |
| `test_derived_points.py` | 11 | Generated points carry their parent's place; nobody else may write them; `completed` is still the user's to set. |
| `test_day_uniqueness.py` | 11 | One primary day per date; the exact ordering that caused the bug; alternates exempt; `PUT /trips` creates its days; the `eager_defaults` regression. |
| `test_db_fixtures.py` | 10 | The test harness's own fixtures. |
| `test_trip_gaps.py` | 9 | What counts as a gap, and that filling one **never calls the model** (the test fails loudly if it does). |
| `test_trip_ai_import.py` | 8 | Document → `TripImport`. |
| `test_chat_tool_loop.py` | 7 | Loop mechanics with a mock client: iteration cap, tool dispatch, error feedback. |
| `test_auth_registration.py` | 6 | Registration through the **real** UserManager: the row really is `is_verified=True`, and a stranger still can't self-grant superuser. |
| `test_document_reuse.py` | 5 | The same PDF on a second trip actually imports (the cached extraction used to carry the first trip's record ids, so the save skipped everything). |
| `test_query_counts.py` | 5 | **N+1 protection.** `GET /trips/{id}` ≤ 8 SELECTs, `GET /points` ≤ 4 — flat regardless of trip size (the fixture builds 12 points). Uses a SQLAlchemy `before_cursor_execute` event to count. |
| `test_date_normalizer.py` | 4 | Relative-date resolution. |

### 7.1 The frontend suite

**88 vitest tests** (`npm run test:run` — note the `run`; the bare `vitest` watches, which hangs CI).
jsdom, `@testing-library/react`, no browser.

| Area | Tests | Covers |
|---|---|---|
| `utils/tripClock.test.js` | | The What's Next clock: countdown thresholds, `nextPoint` ordering. Pins `"in 4h 60m"`, a real bug caused by flooring hours and rounding minutes separately. |
| `utils/format.test.js`, `newTripPayload.test.js`, `tripCache.test.js` | | The pure helpers, the wizard's payload builders, and the IndexedDB offline cache. |
| `store/apiSlice.test.js` | | The RTK Query tag graph and the offline fallback. |
| `hooks/usePlacesAutocomplete.test.jsx` | | Debounce, unmount, and **stale responses** — type "par", pause, type "is"; the slow "par" reply must not overwrite "paris". |
| **Component tests** (added 2026-07-13) | **29** | `NextUpCard` (10), `WhatsNextView` (7), `TripGapsBanner` (7), `ChatChoiceCard` (6). Until then **nothing rendered a React component** — `@testing-library/react` was installed and unused, which is why every UI bug had to be found by driving a browser by hand. They pin the two that shipped ("in 4h 60m", and "be at the airport by…" appearing on an *arrival*) and the property that stops the model inventing geography: a picked place sends **only** an `optionId` or a `placeId`, never coordinates. |

### 7.2 CI and tooling

`.github/workflows/ci.yml`, three jobs:

| Job | Runs |
|---|---|
| **static** | `ruff check .` + `mypy`. No database, so it doesn't queue behind Postgres. |
| **backend** | `pytest -q` against a real `postgres:16` service container. |
| **frontend** | `npm run lint` → `npm run test:run` → `npm run build`. |

Both Python tools are configured in `api/pyproject.toml` and **pinned exactly** in
`requirements-dev.txt` — a floating minor that adds a rule would turn an unrelated PR red.

- **ruff** — `E, W, F, I, UP, B, ASYNC, C4, RUF`. Currently clean. Adopting it surfaced a blocking
  `open()` inside an `async def`, 13 `except` blocks that discarded the original traceback, and 5
  `zip()`s with no `strict=`.
- **mypy** — non-strict, but `check_untyped_defs`. Currently clean, 0 errors over 45 files. The
  `pydantic.mypy` plugin is **required** (without it, every `TripResponse(tripName=…)` is a false
  "unexpected keyword argument" — 105 of them). SQLAlchemy needs **no** plugin: the models use 2.0
  `Mapped[...]` annotations, which mypy reads natively. Adopting it found four latent bugs, including
  a dead code block in `date_normalizer.py` whose two branches returned the identical value.

**The evals are deliberately not in CI.** They cost money and hit a non-deterministic third party.
Run them by hand before merging anything that touches the prompt, the tools or the write layer.

---

## 8. Frontend

React 18 + Vite. MUI for components, Redux Toolkit + **RTK Query** for server state, `dayjs` for
dates, `framer-motion` for timeline animation. It is a **PWA** with an IndexedDB read cache, so an
opened trip survives going offline.

### 8.1 Routes (`App.jsx`)

```
/login, /register              auth
/shared/:token                 SharedTripPage — public, no account needed
/                              TripsPage — your trips
/trip/:tripId                  HomePage — the trip timeline, or What's Next if the trip is active
/trip/:tripId/stays            StayDetailsPage
/trip/:tripId/travels          TravelDetailsPage
/trip/:tripId/workflow         TripWorkflowPage
/new-trip                      NewTripPage — the wizard
/import-trip                   ImportTripPage
/trip-inspection/:tripId       TripInspectionPage
/profile                       ProfilePage
```

### 8.2 Every component

**Pages**

| File | What it is |
|---|---|
| `TripsPage.jsx` | The trip list — your trips, with delete, plus the entry point to the new-trip chat. |
| `HomePage.jsx` | **The main screen.** Renders the timeline + gaps banner while you're planning, and swaps to What's Next once the trip is active (§12). Also hosts the chat FAB, the share dialog and the status menu. |
| `NewTripPage.jsx` | The step-by-step new-trip wizard (dates, route, legs) for people who'd rather fill a form than talk. |
| `ImportTripPage.jsx` | Upload an itinerary document → creates the trip → lands you straight on it. One of two upload paths; the other is the chat (§10). |
| `TripInspectionPage.jsx` | A debug/inspection view of a trip's raw structure. |
| `TripWorkflowPage.jsx` | The standalone chat workflow page. |
| `StayDetailsPage.jsx` | Read-only timeline of the trip's stays, ordered by check-in, each editable. |
| `TravelDetailsPage.jsx` | Read-only timeline of the trip's travel legs, ordered by departure, each editable. |
| `SharedTripPage.jsx` | A trip seen through a share link. The **only** page that renders with no account — reuses the owner's `Timeline` in `readOnly` mode rather than growing a second copy. |
| `ProfilePage.jsx` | Your name, phone, and home location (which seeds the assistant's context). |
| `LoginPage.jsx` / `RegisterPage.jsx` | Auth. |

**Timeline**

| File | What it is |
|---|---|
| `Timeline.jsx` | The trip timeline: expandable days, each holding its ordered points. |
| `DayTimelineItem.jsx` | One day row — date, title, an "alternate" chip, and the add-point control. |
| `PointTimelineItem.jsx` | One point row — time, type icon, title, and the place it happens at. |
| `PointDetailSheet.jsx` | The bottom sheet for a tapped point: times, confirmation number, description, and its locations (with map links). |
| `DetailTimelinePage.jsx` | Shared chrome for the Stay/Travel detail timelines — extracted when those two pages turned out to be near-identical. |

**Chat**

| File | What it is |
|---|---|
| `TripChatOverlay.jsx` | The chat itself. Serves both the Trips page (`trip:new_trip`, no trip id — builds a new trip) and the trip page (`trip:manage` — edits the open one). Consumes the SSE stream, renders status/deltas, and invalidates the RTK cache when the assistant changes anything. |
| `ChatFormCard.jsx` | Renders a server-built form attached to a bot message; posts the values back. Knows nothing about field semantics — it renders what it was handed. |
| `ChatChoiceCard.jsx` | "Which Hyatt did you mean?" — the tappable place options, plus a Places autocomplete for when none of them is right (your brother's house). |

**Trip**

| File | What it is |
|---|---|
| `TripGapsBanner.jsx` | "3 things missing" on the trip page; tapping a gap expands the same server-built form inline and saves it with no model call. |
| `ShareTripDialog.jsx` | The owner's control panel for the trip's share link: create, copy, see whether it's been opened, revoke. |
| `TripStatusMenu.jsx` | Automatic (follow the dates) vs. "On this trip" (force it on). Reads `statusIntent`, not `status`, or its checkmark would lie. |

**What's Next** (§12 — the screen for a trip you're on)

| File | What it is |
|---|---|
| `WhatsNextView.jsx` | The screen: the next thing, what follows it, and a way into the full itinerary. Ticks the countdown every 30s. |
| `NextUpCard.jsx` | The hero card — countdown, place, Maps link, flight number, one-tap confirmation copy, ✓ Done. |
| `ThenList.jsx` | A flat list of what comes after. No day grouping, on purpose. |

**Forms**

| File | What it is |
|---|---|
| `PointForm.jsx` | Create/edit an activity point. |
| `StayForm.jsx` | Create/edit a stay. |
| `TravelForm.jsx` | Create/edit a travel leg. |
| `LocationForm.jsx` | The location sub-form used by the three above — name, role, and a Places autocomplete. |

**Other**

| File | What it is |
|---|---|
| `AppLayout.jsx` | The app shell: top bar, nav drawer, offline indicator. |
| `ErrorBoundary.jsx` | Catches a render error anywhere and shows a recoverable card instead of white-screening the PWA. |
| `TripMapModal.jsx` | A map view of the trip's resolved locations. |

**State, API, utils**

| File | What it is |
|---|---|
| `store/apiSlice.js` | RTK Query: every cache-shaped endpoint, the tag graph (`Trips`, `Trip`, `Verify`, `Gaps`, `AiDocuments`), and an offline fallback that serves the IndexedDB cache on a network error. |
| `store/authSlice.js` | Token and Maps API key. |
| `api/client.js` | The axios instance — attaches the JWT, redirects to `/login` on 401. |
| `api/chatService.js` | The SSE client for `/chat/reply` (with a 90s **idle** timeout — a turn can legitimately take a minute, so it gives up when the stream goes *silent*, not when it's slow), plus form/choice submission and the `uiPayload` accessors. |
| `api/placesService.js` | Google Places (New) autocomplete + details. Kept isolated from the app's own backend client. |
| `api/tripImportService.js` | The multipart/one-shot document endpoints that aren't cache-shaped enough for RTK Query. |
| `hooks/usePlacesAutocomplete.js` | Debounced Places autocomplete. Handles unmount, request failure, and **stale responses** (type "par", pause, type "is" — the slow "par" response must not overwrite "paris"). |
| `utils/format.js` | `placeLabel` (name the place), `placeLocality` (where it is), date/time formatting, sorting. |
| `utils/pointIcons.js` | Point type → icon and label. |
| `utils/tripClock.js` | The whole of What's Next's logic as four pure functions: `nextPoint`, `followingPoints`, `countdown`, and `leaveByHint` ("be at the airport by…" — **departures only**; it once fired on arrivals too). Compares `startUtc` instants, so the browser's timezone cannot change the answer. |
| `utils/tripCache.js` | The IndexedDB read cache behind the offline fallback. |
| `utils/newTripPayload.js` | Pure builders for the new-trip wizard's payload. Notably does **not** build departure/arrival points — the backend derives those. |
| `utils/dayjs.js` | dayjs + a `parseWallClock` that reads a wall-clock string without applying a timezone. |
| `utils/useOnlineStatus.js` | Live online/offline flag. |
| `utils/errors.js` | Turns an API error into a human sentence. |

---

## 9. Worked example: one chat message, end to end

The user is looking at an Okinawa trip (Oct 30 – Nov 5, destination "Okinawa"). They open the chat and
type:

> **"We're staying at the Hyatt."**

**1. The browser.** `TripChatOverlay` calls `sendChatMessage` in `chatService.js`, which POSTs to
`/chat/reply`:

```json
{ "tripId": "…", "workflowName": "trip:manage", "requestId": "<uuid>",
  "message": "We're staying at the Hyatt.", "context": { … } }
```

and starts reading the response as an SSE stream.

**2. `routers/chat.py`.** Ownership is verified **before anything is logged** (a message aimed at
someone else's trip must never reach `ai.log`). The `requestId` is checked against previous replies —
no match, so this is new. The user's message row is inserted and flushed, which *claims* the request
id via the unique constraint. The last 12 turns are loaded as the transcript window; older turns are
folded into the rolling summary. The SSE response opens.

**3. `chat_tool_loop.py`.** It assembles:

- the system prompt (from `pripritrip_system_prompt.md`),
- the runtime context (`appCurrentDate: 2026-07-12`, home location),
- the compact trip summary (dates set, destination Okinawa, 0 stays, 1 travel),
- the `verify_trip` checklist (`MISSING_STAY` for every night — nothing is booked),
- the transcript, and the new message.

...and streams a completion with all 16 tools attached.

**4. Iteration 1 — the model calls a tool.**

```json
create_stay {
  "name": "Hyatt",
  "stayType": "hotel",
  "locations": [{ "role": "venue", "name": "Hyatt" }]
}
```

It set `stayType` because the tool description tells it to infer the obvious, and it attached a
`locations` entry because the tool schema says a named venue *must* appear there and not only in the
title. (Both of those sentences exist because their absence caused a bug.)

An SSE **`status`** event goes to the browser — *"Adding a stay…"* — and the tool is dispatched.

**5. The write layer.** `execute_action` validates the arguments into a `StayDetailCreate` and hands
them to **`trip_write.create_stay`** — the same function `POST /trips/{id}/stay-details` calls when
you fill in the stay form by hand (§3.1). It creates the `StayDetailRecord`. Then, for the location:

`location_resolver.resolve_location("Hyatt", near="Okinawa")` → `_bias_query` sends
`"Hyatt Okinawa"` to Google Places Text Search → **two** candidates come back: *Hyatt Regency Naha*
and *Hyatt Regency Seragaki Island*. `classify()` scores them at 0.32 and 0.24 — neither clears 0.72,
and there's no lead — so the verdict is **`medium`**.

Because it's medium, **the place is not applied**. The location row is saved with `name: "Hyatt"` and
no coordinates, no place id.

**6. Back to the model.** `chat_tools._location_note` turns that decision into two things:

- a **`choice`** object carrying the two real Google place IDs *we* looked up, and
- a note appended to the tool result:

  > *"'Hyatt' is ambiguous, so it was NOT resolved and the user is now choosing between 2 places. Do
  > not ask them which one — the choice is already on screen."*

The tool result goes back as a `role: "tool"` message.

**7. Iteration 2 — the model answers.** No tool calls this time, so its content is the final message.
It streams to the browser as **`delta`** events, arriving word by word:

> *"Added a partial hotel stay: Hyatt. The place name was ambiguous, so I saved the raw name and the
> app is already showing the place options on screen. What are your check-in and check-out dates?"*

Note what it did **not** do: it did not ask "which Hyatt?". It was told not to.

**8. Persist and finish.** The bot message is written with `structure_content` containing the actions
taken, the results, and the `uiPayload` (`kind: "choice"`). The full response payload is stored in
`reply_payload` so a duplicate send replays it. The transaction **commits**. A final SSE **`done`**
event carries the whole payload.

**9. The browser renders.** `TripChatOverlay` reads `choiceFromMessage(botMessage)` and renders a
`ChatChoiceCard` under the bubble: two tappable options with their addresses and map links, an "or"
divider, and a **"Search for a different place"** Places autocomplete.

**10. The user taps *Hyatt Regency Naha*.** `POST /chat/choices/submit` with the `optionId`. The
backend checks that option against the choice it actually issued (a client cannot post an arbitrary
place id here), fetches Place Details for it, and writes the exact place — name, address,
coordinates, place id, timezone — onto the location row. **No model call.** Measured: ~220ms, versus
4–8 seconds for a chat turn.

The RTK cache is invalidated, the timeline re-renders with the resolved hotel, and the gaps banner
recounts.

---

## 10. Other flows, briefly

**Document upload — two paths, and the entry point decides which.**

There is exactly one question a document upload has to answer: *is this a whole itinerary, or one
booking?* The app used to **guess**, from the trip's `status` column — so a hotel confirmation uploaded
to a trip that happened to still be `status: "new"` was run through the itinerary parser. It now learns
it from where you clicked (`workflowName === 'trip:new_trip'`).

1. **Itinerary → a trip.** From the Trips-page toolbar, or the new-trip chat. `document_ingest` extracts
   the text → `trip_ai.structure_itinerary` (pass 1) → `enhance_trip` (pass 2) → `to_trip_import` →
   `POST /trips/{id}/import` writes the rows → **you land on the trip page**. No review screen: the
   timeline shows what it got and the gaps banner shows what's missing, which is a better summary than
   the summary screen was.

2. **Booking confirmation → records on the open trip.** From the chat, on a trip page.
   `POST /trips/{id}/ai-documents` extracts the stays/travels → `POST /ai-documents/{id}/save` writes
   them → the assistant says what it added, in the transcript. **Auto-saved, no review.**

The importer writes stays, travels and *activity* points only; check-in and departure points are then
generated from the stays and legs by `detail_points`, which is also what attaches the airports to them.

Extractions are cached by SHA-256 content hash so the same PDF is only ever sent to OpenAI once — but
a reused payload gets **fresh record ids** (`_remint_record_ids`). Without that, uploading the same
hotel confirmation to a second trip carried the *first* trip's `stayDetailId`, the save step saw an id
that already existed and skipped every record, and the second trip imported nothing at all while
cheerfully reporting `Imported 0 stay records`.

**Gap filling.** `GET /trips/{id}/gaps` walks the assembled trip and returns each hole **with a
server-built form already attached**, split into `blocking` and `worth_adding`. `TripGapsBanner`
renders them on the trip page; tapping one expands the form inline; `POST /trips/{id}/gaps/submit`
applies it through the write layer and returns the *remaining* gaps, so the count visibly goes down.
There is a test that fails loudly if this path ever calls OpenAI.

---

## 11. Share links

Full design in `docs/share_links_plan.md`. The short version:

The owner mints a link (`POST /trips/{id}/share`) and sends it to whoever they're travelling with.
That person opens it with **no account** and sees the itinerary, read-only. The owner can revoke it,
and can see whether it's been opened.

- **The token is a bearer capability** — 256 bits from `secrets.token_urlsafe(32)`. It is stored in
  **plaintext**, deliberately: the owner has to be able to copy the link again later, and you cannot
  show a hash back to them. The protections are entropy and instant revocation, not secrecy at rest.
- **One live link per trip**, held by a partial unique index. That's what makes "revoke" unambiguous.
  Creating is idempotent, so tapping share twice can't invalidate a URL already sitting in someone's
  messages.
- **It includes confirmation numbers.** This is a decision, not an oversight: the person you share
  with is the person travelling with you, and an itinerary that hides the hotel booking reference
  from your partner isn't an itinerary. The mitigation for a leaked link is revocation, not
  redaction. A "hide confirmations" toggle is the obvious follow-up if that trade ever feels wrong.
- **It excludes** the chat transcript, the owner's identity/profile, other trips, uploaded documents,
  and the verify/gaps tooling.
- **Frontend:** `/shared/:token` is a public route outside `ProtectedRoute`, rendering the *same*
  `Timeline` in `readOnly` mode (no add buttons, no edit pencils, no chat FAB) rather than a second
  copy of it that would drift. `ShareTripDialog` is the owner's control panel.

`tests/test_trip_share.py` (16 tests) covers the security boundary: revoked/expired/unknown tokens are
indistinguishable 404s, another user can't share your trip, the payload leaks nothing about the owner,
and holding a link grants no write anywhere.

---

## 12. Being on the trip: `active` and What's Next

Full design in `docs/active_trip_plan.md`. This is the app's first step from *planner* to *companion*.

**A trip goes active on its start date, by itself.** Open it and the day-by-day timeline is replaced by
**What's Next**: one hero card for the next thing you have to do, with an urgent countdown
(`in 3 days` → `in 2h 15m` → `in 40 min` → `NOW`), the place with a Maps link, the flight number, and
the **confirmation number one tap from copy**. A **✓ Done** button ticks it off and the screen advances.
Below it, a flat "Then" list of what follows. The full itinerary is one tap away.

**Derived, never stored.** `services/trip_status.py` computes it on every read. Persisting `active`
would give you two sources of truth — the column and the clock — and they drift: a trip stays active
forever after it ends, or you need a cron job to notice it didn't. The column stores *intent* (§4.1);
`TripResponse` carries both `status` (resolved) and `statusIntent` (stored), because otherwise the
status menu cannot tell an automatically-active trip from a hand-forced one.

**There is almost no date logic**, and that is the point. A point serialises `startUtc`/`endUtc` — the
instants the backend already derived — so `nextPoint()` is one comparison rather than a reconstruction
of a wall clock against a possibly-null timezone. `utils/tripClock.js` is two pure functions, and one
of its tests asserts *the browser's timezone cannot change the answer*. The first draft of the screen
had a "today" concept, a day-of-trip counter and today/tomorrow grouping; cutting them **removed** the
timezone problem rather than solving it.

The assistant is deliberately **not** told the derived status — it renders nothing and behaves no
differently mid-trip, and feeding it a clock-dependent value made the eval harness non-deterministic on
exactly one day of the year.

---

## 13. Known gaps and deliberate deferrals

- **No migrations.** By choice, until just before release. The database is recreated from
  `models.py`. `api/sql/` holds the DDL applied by hand during development;
  `2026-07-11_add_indexes.sql` is written but **not applied**.
- **No collaborative editing.** Read-only share links exist (§11), but a recipient cannot change
  anything and does not appear in the app. `get_owned_trip` is still the single ownership choke
  point, so a `trip_members` table remains the tractable next step.
- **A JWT cannot be revoked.** `POST /auth/logout` is a no-op — the strategy is stateless, so there is
  nothing to destroy, and the token stays valid until it expires. The lifetime (7 days) *is* the blast
  radius of a leak. Making logout real means a `revoked_tokens` denylist or fastapi-users'
  `DatabaseStrategy`. See `docs/auth_test_analysis.md` §3.2.
- **The Maps API key is effectively public.** `/auth/session` hands it to every logged-in user and the
  frontend stores it in `localStorage` — unavoidable, since a browser Maps key must reach the browser.
  **Restrict it by HTTP referrer in the Google Cloud console before deploying.**
- **No rate limiting on `/auth/session`.** Non-issue locally; first thing an attacker tries once
  deployed.
- **The trip's timezone is null on every trip**, so the active-window boundary currently resolves in
  UTC — a few hours of slop at midnight. The fix is to populate `default_timezone_id`, not to make the
  rule cleverer.
- **`/trips/ai-enhance`** exists but is not wired to anything.
- **`ai.log` may contain PII** (message contents, locations). Fine locally; not fine deployed.
- **Verify checks for *missing* data, not *impossible* data.** A 20-minute gap between an activity in
  Shuri and a flight from Naha passes today.
- **The inspection flow overlaps the gaps banner.** `TripInspectionPage` + `TripWorkflowPage` (reached
  by the ✅ on a trip card) and `TripGapsBanner` now answer nearly the same question in two places.
  Kept deliberately, to be resolved later rather than quietly broken.
- **Eval flakiness.** ~1 run in 6 fails on model non-determinism at `--threshold 1.0 --runs 1`. One
  scenario (`partial-capture-flight`) makes this worse than it needs to be by asserting on a literal
  question mark — see §6.2.
- **Python dependencies are not pinned.** `requirements.txt` is 14 lines of `>=` with no lockfile, so
  `pip install` today and in three months resolve to different builds and CI is not reproducible. The
  frontend does this right (`package-lock.json` is committed); `ruff` and `mypy` are pinned exactly.
  The rest are not. **This is the last open item from `review.md`'s original top ten** (R10).
