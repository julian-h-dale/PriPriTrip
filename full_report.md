# PriPriTrip — Full Technical Report

*Written 2026-07-12. This is the "you know nothing about this project" document. It is not a
quick-start; it is the map. Where something is subtle or was got wrong once, it says so.*

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

**Current state:** local-only, single-user-per-trip, no deployment. Migrations are deliberately
deferred — the database is recreated from `models.py` rather than migrated, and there is no Alembic.
Two test tiers exist: 228 pytest tests against a real throwaway Postgres, and 15 live-model eval
scenarios against the real OpenAI API.

---

## 2. Repository layout

```
PriPriTrip/
├── api/
│   ├── app/
│   │   ├── main.py               FastAPI app factory, CORS, router registration
│   │   ├── database.py           Engine, session factory, declarative Base
│   │   ├── models.py             All 8 SQLAlchemy models + soft-delete helpers
│   │   ├── schemas.py            Every Pydantic wire model (camelCase on the wire)
│   │   ├── enums.py              PointType, LocationRole, TravelMode, StayType + DERIVED_POINT_TYPES
│   │   ├── settings.py           Pydantic settings, read from .env
│   │   ├── auth.py               require_auth dependency
│   │   ├── users.py              fastapi-users wiring (JWT)
│   │   ├── dependencies.py       get_owned_trip / require_owned_trip
│   │   ├── routers/              HTTP layer — thin, no business logic
│   │   └── services/             All the actual logic
│   ├── evals/                    The live-model prompt test harness (§6)
│   ├── tests/                    pytest, against a real Postgres (§7)
│   ├── sql/                      Hand-written DDL applied during development
│   └── pripritrip_system_prompt.md   The assistant's system prompt (sectioned)
├── ui/
│   └── src/                      React app (§8)
└── docs/                         Stopping-point docs, source PDFs, this file
```

---

## 3. Architecture: the five rules

Almost every design decision in the backend follows from one of these. If you understand these, the
code stops being surprising.

### 3.1 The executor is the single write path

Every mutation to trip content — from the chat assistant, from a submitted form, from a gap-fill —
goes through **`services/trip_action_executor.py::execute_action`**. It takes an `AssistantAction`
(`{op, target, id, fields}`) and applies it.

This is why the assistant cannot corrupt the database in ways a form can't: they run the same code.
Validation, timezone derivation, location resolution, and generated-point syncing all live behind
that one door. The REST routers (`trip_points.py`, `trip_details.py`, …) are a second door used by
the UI's own forms, and they are kept deliberately in step with the executor — when a rule is added
to one, it is added to both, and there is a test for each.

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

All in `app/models.py`. Eight tables.

| Model | Table | What it is |
|---|---|---|
| `UserRecord` | `users` | A person: fastapi-users' auth columns plus name, phone, and a home location (name, address, coords, place id, timezone) used to give the assistant a default context. |
| `TripRecord` | `trips` | One trip: name, status (`new`/`draft`/…), start/end dates, start & destination location *names* (free text, not resolved places), default timezone. |
| `TripDayRecord` | `trip_days` | One calendar day of a trip — the timeline's top-level grouping; `is_alternate` marks a competing plan for the same date. |
| `TripPointRecord` | `trip_points` | One thing that happens at a time: an activity you authored, or a check-in/departure the backend derived from a stay or travel leg (`is_system_created`). |
| `StayDetailRecord` | `stay_details` | One accommodation booking spanning multiple nights: name, type, check-in/out, room type, confirmation number. |
| `TravelDetailRecord` | `travel_details` | One journey leg — flight, train, drive: mode, operator, vehicle number, cabin class, departure/arrival. |
| `LocationRecord` | `locations` | A place, owned by *exactly one* of a point, stay, or travel (enforced by a `num_nonnulls(...) = 1` check constraint); carries the Google-resolved address, coordinates, place id and timezone. |
| `AIDocumentRecord` | `ai_documents` | An uploaded itinerary/booking document: its extracted text, the AI's structured extraction, and the resulting import payload — kept so an import can be reviewed and re-run without re-uploading. |
| `ChatMessageRecord` | `chat_messages` | One turn of a chat, user or bot; the bot row also stores `structure_content` (actions taken, the `uiPayload`) and `reply_payload` (the exact response, for idempotent replay). |

**Soft delete.** Most models carry `SoftDeleteMixin` (`is_deleted` + `deleted_at`). A row is only
"deleted" when **both** agree — use the `active(Model)` / `deleted(Model)` helpers rather than
writing the filter yourself. `LocationRecord` is the exception: it has no soft delete, because it
dies with its owner (`ON DELETE CASCADE`).

**Relationships bake in the soft-delete filter.** `TripRecord.days`, `.stays`, `.travels` and
`TripDayRecord.points` are `viewonly` relationships whose `primaryjoin` already excludes deleted
rows, so a caller *cannot forget* the filter. Writes still go through the executor explicitly.

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
| `trip_action_executor.py` | **The single write path.** Applies an `AssistantAction` to the DB: validates, normalizes dates, resolves locations, derives UTC, syncs generated points, and returns an `ActionResult` (`ok`/`error` + a `detail` the model can act on). |
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
| `locations.py` | Shared `LocationRecord` row construction. |

### 4.3 API surface

```
Auth        POST   /auth/session, /auth/register/session, /auth/login, /auth/register, /auth/logout
Profile     GET|PUT|DELETE /profile, POST /profile/timezone
Trips       GET  /trips
            GET|PUT|DELETE /trips/{id}
            GET  /trips/{id}/verify
Days        GET|POST /trips/{id}/days, PATCH|DELETE /trips/{id}/days/{day_id}
            GET  /trips/{id}/days/deleted, POST .../restore
Points      GET|POST /trips/{id}/points, PATCH|DELETE /trips/{id}/points/{point_id}
            GET  /trips/{id}/points/deleted, POST .../restore
Details     GET|POST /trips/{id}/stay-details,   GET|PATCH|DELETE .../{stay_detail_id}
            GET|POST /trips/{id}/travel-details, GET|PATCH|DELETE .../{travel_detail_id}
Import      POST /trips/{id}/import              (structured payload → rows)
            POST /trips/{id}/ai-import, /trips/ai-import, /trips/ai-enhance
            POST|GET /trips/{id}/ai-documents, GET /ai-documents/{id}, .../regen, .../save
Chat        POST /chat/reply           (SSE)
            GET  /chat/trips/{id}
            POST /chat/forms/submit
            POST /chat/choices/submit
Gaps        GET  /trips/{id}/gaps
            POST /trips/{id}/gaps/submit
```

`GET /trips/{id}` returns the whole assembled trip (days → points → locations, plus stays and travels
with their locations) in a **flat number of queries** — 8 SELECTs regardless of trip size, pinned by
`tests/test_query_counts.py`.

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

Every mutating tool converts its arguments into an `AssistantAction` and runs `execute_action`. The
executor's `ActionResult` — including its errors — is returned to the model as the tool result. **That
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
call at all** — they go straight through the executor:

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
means one unlucky run fails the suite. Across recent history one run in roughly six came back 14/15
without a reproducible cause. When judging a change, run it more than once.

---

## 7. The pytest suite (for contrast)

228 tests, all against a **real, throwaway PostgreSQL database** (`pripritrip_test`, recreated per
session; `conftest.py` asserts it will never point at the dev DB). Each test runs in a transaction +
savepoint that is rolled back, so tests don't accumulate state.

Moving off fake sessions was itself valuable — it immediately exposed two real bugs (the chat
rollback, and a fixture whose user row was being erased by an endpoint's rollback).

| File | Tests | Covers |
|---|---|---|
| `test_location_choice.py` | 23 | The confidence rule, the executor no longer guessing, `apply_choice` security (an option we never offered is rejected; a location on another trip is rejected; a *searched* place is accepted but still can't cross trips). |
| `test_chat_forms.py` | 21 | The form registry, form building, and submission re-validation. |
| `test_auth.py` | 20 | Session/register endpoints on real DI. |
| `test_trip.py` | 19 | Trip CRUD, ownership. |
| `test_action_ids.py` | 17 | The executor's id handling (invented ids are rejected/regenerated, and the model is told). |
| `test_trip_days.py` | 15 | Day CRUD, soft delete, restore. |
| `test_chat.py` | 13 | `/chat/reply`: SSE, idempotency, replay, failure rollback. |
| `test_trip_verify.py` | 12 | All 9 verify issue codes. |
| `test_trip_details.py` | 12 | Stay/travel CRUD. |
| `test_eval_harness.py` | 11 | **The eval harness itself**, using the mock OpenAI client. |
| `test_derived_points.py` | 11 | Generated points carry their parent's place; nobody else may write them; `completed` is still the user's to set. |
| `test_day_uniqueness.py` | 11 | One primary day per date; the exact ordering that caused the bug; alternates exempt; `PUT /trips` creates its days; the `eager_defaults` regression. |
| `test_db_fixtures.py` | 10 | The test harness's own fixtures. |
| `test_trip_gaps.py` | 9 | What counts as a gap, and that filling one **never calls the model** (the test fails loudly if it does). |
| `test_trip_ai_import.py` | 8 | Document → `TripImport`. |
| `test_chat_tool_loop.py` | 7 | Loop mechanics with a mock client: iteration cap, tool dispatch, error feedback. |
| `test_query_counts.py` | 5 | **N+1 protection.** `GET /trips/{id}` = 8 SELECTs, `GET /points` = 4, flat regardless of trip size. Uses a SQLAlchemy `before_cursor_execute` event to count. |
| `test_date_normalizer.py` | 4 | Relative-date resolution. |

---

## 8. Frontend

React 18 + Vite. MUI for components, Redux Toolkit + **RTK Query** for server state, `dayjs` for
dates, `framer-motion` for timeline animation. It is a **PWA** with an IndexedDB read cache, so an
opened trip survives going offline.

### 8.1 Routes (`App.jsx`)

```
/login, /register              auth
/                              TripsPage — your trips
/trip/:tripId                  HomePage — the trip timeline (the main screen)
/trip/:tripId/stays            StayDetailsPage
/trip/:tripId/travels          TravelDetailsPage
/trip/:tripId/document-import          DocumentImporterPage
/trip/:tripId/document-import/review   DocumentImportReviewPage
/trip/:tripId/workflow         TripWorkflowPage
/new-trip                      NewTripPage — the wizard
/import-trip                   ImportTripPage
/import-summary/:tripId        ImportSummaryPage
/trip-inspection/:tripId       TripInspectionPage
/profile                       ProfilePage
```

### 8.2 Every component

**Pages**

| File | What it is |
|---|---|
| `TripsPage.jsx` | The trip list — your trips, with delete, plus the entry point to the new-trip chat. |
| `HomePage.jsx` | **The main screen.** The trip timeline (days → points), the gaps banner, and the chat FAB. |
| `NewTripPage.jsx` | The step-by-step new-trip wizard (dates, route, legs) for people who'd rather fill a form than talk. |
| `ImportTripPage.jsx` | Entry point for importing a trip from a document. |
| `DocumentImporterPage.jsx` | Upload an itinerary/booking document for AI extraction. |
| `DocumentImportReviewPage.jsx` | Review and correct what the AI extracted from a document *before* it is written to the trip. |
| `ImportSummaryPage.jsx` | Post-import summary of what was created. |
| `TripInspectionPage.jsx` | A debug/inspection view of a trip's raw structure. |
| `TripWorkflowPage.jsx` | The standalone chat workflow page. |
| `StayDetailsPage.jsx` | Read-only timeline of the trip's stays, ordered by check-in, each editable. |
| `TravelDetailsPage.jsx` | Read-only timeline of the trip's travel legs, ordered by departure, each editable. |
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

**5. The executor.** `execute_action` creates the `StayDetailRecord`. Then, for the location:

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

**Document import.** Upload a PDF/XLSX → `document_ingest` extracts text → `trip_ai.structure_itinerary`
(pass 1) turns it into an `AITrip` → `enhance_trip` (pass 2) makes it engaging → `to_trip_import`
converts it to a `TripImport` → the user **reviews it** on `DocumentImportReviewPage` → `POST
/trips/{id}/import` writes the rows. The importer writes stays, travels and *activity* points only;
check-in and departure points are then generated from the stays and legs by `detail_points`, which is
also what attaches the airports to them.

**Gap filling.** `GET /trips/{id}/gaps` walks the assembled trip and returns each hole **with a
server-built form already attached**, split into `blocking` and `worth_adding`. `TripGapsBanner`
renders them on the trip page; tapping one expands the form inline; `POST /trips/{id}/gaps/submit`
applies it through the executor and returns the *remaining* gaps, so the count visibly goes down.
There is a test that fails loudly if this path ever calls OpenAI.

---

## 11. Known gaps and deliberate deferrals

- **No migrations.** By choice, until just before release. The database is recreated from
  `models.py`. `api/sql/` holds the DDL applied by hand during development;
  `2026-07-11_add_indexes.sql` is written but **not applied**.
- **Single-user trips.** No sharing. `get_owned_trip` is the single ownership choke point, so a
  `trip_members` table would be tractable — this is the most-requested-shaped feature.
- **No "Today" view.** The app is a trip *planner*, not yet a trip *companion*. Every feature serves
  you before you leave; the moment the trip starts it has nothing special to say. This is the biggest
  product hole (see `docs/july_11_stop.md`).
- **`/trips/ai-enhance`** exists but is not wired to anything.
- **`ai.log` may contain PII** (message contents, locations). Fine locally; not fine deployed.
- **Verify checks for *missing* data, not *impossible* data.** A 20-minute gap between an activity in
  Shuri and a flight from Naha passes today.
- **Eval flakiness.** ~1 run in 6 fails on model non-determinism at `--threshold 1.0 --runs 1`.
