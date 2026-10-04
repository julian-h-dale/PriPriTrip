# PriPriTrip — Codebase Review (second pass)

**Date:** 2026-07-13
**Branch:** `llm-translate`
**Scope:** whole repo — backend, frontend, tests, evals, tooling, process.
**Method:** read the source; where a finding was a *behavioural* claim, I proved it with a throwaway
script against a scratch database rather than asserting it. Those are marked **VERIFIED** and the
actual output is quoted.

> ### ✅ Update 2026-07-13 — S1 is done, and R1/R2/R3 with it
>
> `services/trip_write.py` now owns every domain rule. **Six** write paths call it (the chat executor,
> the four REST routers, and both importers) and none of them contains a rule. R1, R2 and R3 are fixed
> — not individually patched, but made *structurally impossible*, because there is no longer a second
> place for a rule to be missing from. See [What shipped](#what-shipped-s1).
>
> ### ✅ Update 2026-07-13 — the safety nets are on: R8, R9, R11, R19
>
> CI now gates on **ruff** (clean), **mypy** (clean, 0 errors), **302 pytest** and **88 frontend tests**
> — 29 of which render an actual React component, which nothing did before. The N+1 point serializer is
> gone. See [What shipped](#what-shipped-r8-r9-r11-r19).

---

## ⚠️ A note on the previous review's numbering

The first review (2026-07-09) used IDs like `1C-3`, `3F-5`. **73 code comments across 32 files cite
those IDs** — `// (review.md 3F-5)`, `# review.md 1C-3`, and so on. This document replaces that
review's content, so every one of those references now points at nothing.

That is itself a finding (**R16**). This review uses a fresh `R#` scheme and does not reuse the old
numbers.

---

## Table of contents

1. [Executive summary](#executive-summary)
2. [What is genuinely good](#what-is-genuinely-good)
3. [🔴 Correctness bugs (verified)](#-correctness-bugs-verified)
4. [🟠 Architecture](#-architecture)
5. [Tooling, CI and process](#tooling-ci-and-process)
6. [Frontend](#frontend)
7. [Dead code, docs and hygiene](#dead-code-docs-and-hygiene)
8. [Simplification opportunities](#simplification-opportunities)
9. [Priority roadmap](#priority-roadmap)

---

## Executive summary

Since the first review this codebase has improved a great deal. The test suite is real (285 tests
against a real Postgres), the AI architecture is a proper tool-calling loop with a closed feedback
path, the domain modelling is careful, and there is a genuinely unusual asset in the **eval harness** —
very few teams test their prompts against the live model with structural assertions.

**The central problem is now structural, and it is producing real bugs.**

> **There are two write paths — the chat executor and the REST routers — and they implement the same
> domain rules independently.** Every time a rule is added to one and not the other, the app develops a
> split personality. That is not hypothetical: **all three of the correctness bugs below are instances
> of it**, and each was introduced by a *correct* fix that got applied to one door and not the other.

The single highest-value change in this repo is to collapse those two paths into one. Most of
[Simplification](#simplification-opportunities) follows from it.

Two other things stand out. **CI does not run the 58 frontend tests** — the frontend job is lint-and-build
only, which is why every UI bug found in the last week was caught by manually driving a browser rather
than by the suite. And there is **no Python linter, formatter or type checker anywhere** — not in CI,
not in a config file. `pyflakes` is being run by hand.

### Top 10 by impact

| # | Sev | Area | Issue |
|---|-----|------|-------|
| **R1** | ✅ | Correctness | ~~A chat-built trip stays `status="new"` → an itinerary upload **silently deletes it**.~~ **FIXED** |
| **R2** | ✅ | Correctness | ~~Chat-created stays get **`UTC` instead of the venue's timezone** — a 9-hour error in `startUtc`.~~ **FIXED** |
| **R3** | ✅ | Correctness | ~~The assistant **cannot clear a field**, and the tool reports `ok`.~~ **FIXED** |
| **R8** | ✅ | CI | ~~**CI never runs the frontend tests.**~~ Fixed — `npm run test:run` gates CI. |
| **R4** | ✅ | Architecture | ~~Two write paths implementing the same rules.~~ **FIXED — `services/trip_write.py`** |
| **R5** | ✅ | Architecture | ~~`execute_action` is a **single ~510-line function**.~~ **FIXED — table-driven, 739 → 343 lines** |
| **R9** | ✅ | Tooling | ~~No ruff/black/mypy.~~ Fixed — both clean, both gate CI. |
| **R11** | ✅ | Frontend | ~~**Zero component tests.**~~ Fixed — 29 render tests across 4 components. |
| **R6** | 🟠 | Duplication | A travel leg's field list is declared in **6 places across 5 files**. |
| **R10** | 🟠 | Supply chain | **Zero pinned Python dependencies**, no lockfile. |

---

## What is genuinely good

Not filler — these are hard things that many professional teams get wrong.

**The three-column time model.** `departure_local` (wall clock) + `departure_tzid` (which clock) +
`departure_utc` (the derived instant). Most codebases store one and regret it. This is right, and using
real `DATE` columns for pure dates is right too.

**The eval harness.** `api/evals/` runs the real tool loop against the live model and asserts on
*structural consequences* — tools called, actions persisted, `uiPayload` attached — and explicitly never
on wording. It has caught real regressions, including a prompt change that made the model start dropping
`stayType`. This is a genuine asset and it is rare.

**Errors are the model's feedback channel.** Executor failures come back as tool results, and the
messages are written *for the model* — they say what to do instead ("Update the travel leg (a1b2…)
instead"). Right instinct, well executed.

**The model may not invent facts it cannot know.** No lat/lng, no place IDs, no form field types.
`create_point`'s schema is literally `{"const": "activity"}`. Narrowing a contract so a bug *cannot be
expressed* is much stronger than validating it afterwards.

**Invariants pushed into the database.** `uq_trip_days_one_primary_per_date`, the single-owner `CHECK`
on locations, the idempotency `UNIQUE` on chat messages. Constraints beat conventions.

**Query-count tests.** `test_query_counts.py` pins `GET /trips/{id}` at 8 SELECTs regardless of trip
size. Almost nobody does this, and it is the only thing that actually stops N+1 creeping back.

**Comments explain *why*, and often name the bug they prevent.** Unusually good, and it made this review
much faster. Keep doing it.

---

## 🔴 Correctness bugs (verified)

All three are the same shape: **a rule was added to the REST routers but not to the executor.** See R4.

---

### R1 🔴 A chat-built trip can be silently destroyed by an itinerary upload

**VERIFIED.** Probe output:

```
shell trip created by chat.py       status='new'
executor create_stay                status='ok'
trip AFTER the chat created a stay  status='new'   <-- still 'new'

itinerary import LOCKED?            False
  (import is a FULL REPLACE — False means an upload would DELETE that stay)
effective_status on its start date  TripStatus.NEW
  (NEW means it can never show What's Next)
```

**The chain.** `promote_to_draft()` moves a trip `new → draft` when it gains content. It is called from
`trip_details.py`, `trip_points.py`, `trip_import.py` and `trip_ai_import.py` — but **not from
`trip_action_executor.py`**. So content created by the *assistant* never promotes the trip.

`chat.py` creates the shell trip as `status="new"`. The only escape is
`mark_trip_draft_after_chat_completion`, which fires **only** for `workflowName == "trip:new_trip"` **and
only if the trip is "complete"** (stays > 0 *and* travels > 0 *and* destination *and* both dates).

So: tell the assistant *"I'm staying at the Hyatt in Okinawa"* and stop there. The trip has a stay, and
`status` is still `new`. Two consequences:

1. `_itinerary_doc_locked()` is `trip.status != "new"` → **False**. An itinerary import is a **full
   replace** (`trip_import.py` deletes every point, day, stay and travel). Uploading an itinerary to that
   trip **deletes the stay the assistant just created**, without a word.
2. `effective_status()` returns `NEW`, which is never active. **That trip can never show What's Next**,
   even on its start date.

**Fix:** call `promote_to_draft(trip)` in the executor's create branches. The executor already holds the
`trip` object, so this is a two-line change plus a test. It is the fifth door and it was missed.

---

### R2 🔴 The assistant stamps `UTC` on a stay it has just resolved to Okinawa

**VERIFIED.** Same hotel, same coordinates, two write paths:

```
CHAT-created stay  check_in_tzid = 'UTC'
                   check_in_utc  = 2026-10-30 16:00:00+00:00
FORM would compute check_in_tzid = 'Asia/Tokyo'
```

**A nine-hour error.**

The REST path (`trip_details.py`) does:

```python
check_in_tzid = body.check_in_timezone_id or infer_tzid_from_locations(
    stay.locations, role="venue", fallback=trip.default_timezone_id
)
```

The executor (`trip_action_executor.py`) does:

```python
def _trip_tz(trip: TripRecord) -> str:
    return trip.default_timezone_id or "UTC"      # ← that is the whole function
```

`infer_tzid_from_locations` appears **9 times in the routers and 0 times in the executor.**

What makes this galling is that the executor has *just resolved the location through Google Places* and
is holding its latitude and longitude — then throws them away and stamps UTC, because
`default_timezone_id` is `NULL` on **every trip in the database** (13/13).

**Blast radius:**

- `check_in_utc` / `departure_utc` are wrong by the destination's UTC offset.
- `startUtc` on every generated point is therefore wrong — and **`startUtc` is the entire basis of the
  What's Next screen.** The countdown will say "in 9 hours" for something happening now.
- Cross-timezone ordering of the timeline is wrong.

**Fix:** the executor must use `infer_tzid_from_locations` with the locations it just resolved, exactly
as the routers do. Better: **there should not be two answers to this question at all** (R4).

---

### R3 🔴 The assistant cannot clear a field — and reports success

**VERIFIED.**

```
before:  confirmation_number = 'WRONG-123'
model called update_stay(confirmationNumber=None) -> 'ok'
after:   confirmation_number = 'WRONG-123'
```

`chat_tools._to_action()` does:

```python
data = args.model_dump(mode="json", exclude_none=True)
```

`exclude_none=True` drops every key the model set to `null`. The key never reaches
`AssistantActionFields`, so it is absent from `patch.model_fields_set`, so the executor's
`if field in patch.model_fields_set` is `False` and **nothing is written**. The tool then returns
`status: "ok"`.

So *"that confirmation number is wrong, remove it"* → the assistant calls the tool → the tool says OK →
the assistant tells you it's done → **the value is unchanged.**

This directly violates the codebase's own rule, stated in the system prompt:

> *Never tell the user something was saved unless the tool result said ok.*

The tool **did** say ok. The contract is lying to the model, which then lies to the user.

**Fix.** Use `exclude_unset=True` rather than `exclude_none=True`, so "absent" and "explicitly null" stay
distinguishable end to end. Pydantic already tracks the difference — the information is being deliberately
thrown away. At an absolute minimum, a no-op update must not report `ok`.

---

## 🟠 Architecture

### R4 🟠 Two write paths, one domain — the root cause of R1, R2 and R3

`docs/full_report.md` calls the executor "the single write path", then immediately concedes the REST
routers are "a second door… kept deliberately in step". **They are not in step.** Measured:

| rule | executor | REST routers |
|---|---|---|
| `infer_tzid_from_locations` | **0** | 9 |
| `promote_to_draft` | **0** | 5 |
| `derive_utc` | 13 | 14 |
| `sync_*_generated_points` | 3 | 3 |
| `generated_point_conflict` | 2 | 2 |
| `DERIVED_POINT_TYPES` guard | 3 | 6 |

The two rows with a **0** are exactly R1 and R2. That is not a coincidence — it is what "keep two
implementations in sync by remembering to" always produces.

**"Kept in sync by discipline" is not an architecture. It is a bug generator with a delay fuse.**

**Recommended shape.** One domain layer; both doors call it:

```
routers/*  ─┐
            ├─►  services/trip_write.py   ─►  DB
executor   ─┘     create_stay(db, trip, StayInput) -> StayDetailRecord
                  update_stay(db, trip, stay_id, StayPatch)
                  …
```

`trip_write.create_stay()` owns timezone inference, UTC derivation, location resolution, generated-point
sync and `promote_to_draft`. The executor becomes a thin adapter from `AssistantAction` → that call. The
routers become a thin adapter from an HTTP body → that call. **Neither contains a rule.**

This is the highest-value refactor available, and it makes R1, R2 and R3 structurally impossible rather
than individually patched.

---

### R5 🟠 `execute_action` is a single ~510-line function

`trip_action_executor.py:229–739`. One function: a 4-way `target` dispatch × 3 ops, ~12 branches, each a
near-verbatim copy of the others:

```
coerce id → validate payload → build record → set the three time columns
→ flush → replace locations → sync generated points → build ActionResult
```

Four times, with the nouns swapped. The `stay` and `travel` create branches are structurally identical
for ~55 lines each.

This is well past what any style guide tolerates, and it is *why* R1 and R2 could hide: a rule missing
from one of twelve near-identical blocks is invisible.

**Simplification — a per-target descriptor table:**

```python
@dataclass(frozen=True)
class TargetSpec:
    model: type[Base]
    pk: str
    create_schema: type[BaseModel]
    patch_schema: type[BaseModel]
    sync: Callable | None                  # sync_stay_generated_points, …
    time_fields: tuple[TimeTriple, ...]    # (check_in_local, check_in_tzid, check_in_utc), …

TARGETS = {"stay": TargetSpec(StayDetailRecord, "stay_detail_id", StayDetailImport, …), …}
```

`execute_action` becomes ~60 lines of generic create/update/delete driven by the table, and each target's
*differences* become data you can read at a glance. That is where a missing `promote_to_draft` would have
been obvious.

---

### R6 🟠 A travel leg's shape is declared in six places across five files

| file | class |
|---|---|
| `schemas.py` | `TravelDetail` |
| `schemas.py` | `TravelDetailImport` |
| `schemas.py` | `TravelDetailPatch` |
| `services/trip_ai.py` | `AITravel` |
| `services/chat_tools.py` | `CreateTravelArgs` |
| `services/chat_tools.py` | `UpdateTravelArgs` |

Plus the field must appear in `llm_contract.AssistantActionFields` and `chat_forms.FIELD_SPECS`.

**Adding one field to a travel leg is an eight-file edit**, and nothing fails if you miss one — the field
just silently doesn't work on that path. (That is R2, one level up.)

Some of this is legitimate: the AI models must stay camelCase and ID-free *by design*, and a `Patch` model
genuinely differs from a `Create`. But `TravelDetail` / `TravelDetailImport` / `TravelDetailPatch` are
three near-identical declarations of the same 14 fields, and two can be generated from the third:

```python
class TravelFields(APIModel):           # the one true field list
    name: str | None = None
    mode: TravelMode
    operator: str | None = None
    ...

TravelDetailPatch  = make_optional(TravelFields)   # every field optional
TravelDetailImport = TravelFields + ids
```

---

### R7 🟠 `AssistantActionFields` is still a 42-field optional bag

The previous review flagged the "shared 45-field optional bag", and `chat_tools` grew per-tool argument
models to escape it. But **every tool converts straight back into it**:

```python
fields=AssistantActionFields.model_validate(data)     # chat_tools.py:258
```

The type safety gained at the tool boundary is discarded one line later, and the executor still receives
a bag where every field is `Optional` and **nothing distinguishes "absent" from "null"** — which *is* R3.

If R4 lands (a real domain layer with per-entity input types), this class disappears entirely.

---

## Tooling, CI and process

### R8 ✅ CI never runs the frontend tests — *fixed*

`.github/workflows/ci.yml`:

```yaml
  frontend:
    - name: Lint    → npm run lint
    - name: Build   → npm run build
```

That is the whole job. **There are 58 frontend tests and not one of them gates a merge.** `package.json`
has `"test": "vitest"` — watch mode, which would hang CI forever — so there isn't even a runnable script
for it.

This is why every UI bug found this week (`"in 4h 60m"`, "be at the airport by…" on an *arrival*, a
truncated trip title) was caught by manually driving a browser. The suite would have caught two of the
three.

**Fix (5 minutes):**

```json
"scripts": { "test": "vitest", "test:run": "vitest run" }
```

```yaml
      - name: Test
        run: npm run test:run
        working-directory: ui
```

### R9 ✅ There is no Python linter, formatter or type checker — *fixed*

No `pyproject.toml`. No `ruff.toml`, no `setup.cfg`, no `mypy.ini`. No lint step in CI. `pyflakes` is
invoked by hand, and it catches unused imports and essentially nothing else.

For a 10k-line async Python codebase this is the biggest missing safety net after R8:

- **`ruff`** replaces pyflakes, adds import sorting, and catches a long tail of real bugs (mutable
  defaults, unused arguments, bare `except`) with near-zero configuration.
- **`mypy`** — even non-strict, even only over `app/services/` — is worth a lot here. The codebase is full
  of `str | None` flowing into functions that assume a value, and **R2 is exactly the kind of thing a typed
  domain layer surfaces.**
- **`ruff format`** (or black): there is no formatter, so style is maintained by hand.

```toml
# api/pyproject.toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "ASYNC", "RUF"]

[tool.mypy]
python_version = "3.12"
files = ["app"]
ignore_missing_imports = true
```

### R10 🟠 Zero pinned Python dependencies

```
fastapi>=0.111.0
sqlalchemy[asyncio]>=2.0
openai>=1.40.0
…
```

**14 lines, 0 exact pins, no lockfile.** `pip install -r requirements.txt` today and in three months
resolve to different builds, so CI is not reproducible and a breaking minor release of `fastapi-users`
or `openai` will arrive as a mystery CI failure with no code change.

The frontend does this correctly — `package-lock.json` is committed. Do the same on the backend:
`uv`/`pip-tools` producing a lock file, or `pyproject.toml` + `uv.lock`.

### R11 ✅ Zero component tests — *fixed*

All 58 frontend tests are utils, hooks and the store:

```
utils/format.test.js          utils/tripClock.test.js       utils/tripCache.test.js
utils/newTripPayload.test.js  store/apiSlice.test.js        hooks/usePlacesAutocomplete.test.jsx
```

**Not one test renders a React component.** `@testing-library/react` is installed and unused.

The pure-function tests are good — `tripClock.test.js` is genuinely well done. But the components are
where the bugs have actually been, and every one was found by driving a browser by hand. A handful of
render tests on `NextUpCard`, `ChatChoiceCard`, `TripGapsBanner` and `WhatsNextView` would pay for
themselves immediately.

---

## Frontend

### R12 🟡 No prop contracts at all

`eslint.config.js` sets `'react/prop-types': 'off'`, and there is no TypeScript. A component's props are
completely uncontracted:

```jsx
export default function NextUpCard({ point, now, onDone, busy = false }) {
```

`point` is an object with ~25 fields whose shape lives only in `schemas.py`, on the other side of the
wire. Rename `startUtc` in the backend and **nothing anywhere fails** — the card silently renders
`undefined`.

Options, in increasing order of value:

1. Turn `react/prop-types` back on and declare shapes. Cheap, ugly, works.
2. **Adopt TypeScript incrementally** — Vite handles mixed `.jsx`/`.tsx` with no migration step.
3. **Generate the frontend types from FastAPI's OpenAPI schema** (`openapi-typescript`). This is the one
   I would actually do: the backend already publishes a complete, accurate schema, and one npm script
   turns it into types that *cannot* drift from the server.

### R13 🟡 Three HTTP mechanisms coexist

- **RTK Query** (`apiSlice.js`) — 21 files. The main path.
- **axios** (`api/client.js`) — 5 files (`chatService`, `placesService`, `profileService`,
  `tripImportService`).
- **raw `fetch`** — 2 files.

The `fetch` in `chatService.js` is *justified* — SSE needs a streaming body and axios can't do it. The
axios layer is not: it re-implements auth-header injection and 401 handling that `apiSlice`'s `baseQuery`
already does, in a second place, with slightly different behaviour.

`profileService` and `tripImportService` are ordinary JSON calls and belong in `apiSlice`. That leaves
exactly two mechanisms, each with a reason: RTK Query for everything, `fetch` for the SSE stream.

### R14 🟡 Four forms, 1,345 lines, one skeleton

| file | lines |
|---|---|
| `TravelForm.jsx` | 395 |
| `PointForm.jsx` | 373 |
| `StayForm.jsx` | 340 |
| `LocationForm.jsx` | 237 |

Each independently implements: local state seeded from `initialValues`, a saving flag, an error state, a
submit handler, a delete handler, and MUI dialog chrome.

Meanwhile **the backend already has a form registry** — `chat_forms.FIELD_SPECS` knows every field's
label, type and options, and `ChatFormCard.jsx` renders a server-described form generically in ~120 lines.
The app therefore contains *both* a generic server-driven form renderer *and* four hand-written forms for
the same entities.

That is the clearest simplification in the frontend: extend `FIELD_SPECS` to cover what the hand-written
forms need, and delete them.

### R15 🟡 `TripChatOverlay.jsx` is 607 lines

Message loading, SSE streaming, optimistic updates, idempotency keys, document upload (two flows), form
submission, choice submission — and all the rendering. Seven `useState`s and three `useRef`s.

Extract `useChatMessages()` and `useDocumentUpload()`; the component drops to render logic.

---

## Dead code, docs and hygiene

### R16 🟡 73 code comments cite a document that no longer says those things

```
13 × review.md 3F-5      10 × review.md 3F-2      8 × review.md 3D-5
 7 × review.md 3C-6       7 × review.md 1C-3      …
```

Across 32 files. The idea — anchor a decision to its rationale — was good. The problem is that the anchor
is a *mutable document*, and it has now moved.

**Recommendation:** the *reason* should live in the comment, and mostly it already does — the comments in
this codebase are genuinely good on their own. Drop the citations, or point them at something immutable
(a commit SHA, or `docs/decisions/NNNN-*.md` ADR files that are appended to and never rewritten).

### R17 🟡 The "two-pass" import pipeline has been dead for some time

`docs/full_report.md` describes document import as *"a two-pass OpenAI pipeline (`structure_itinerary` →
`enhance_trip`)"*. **It isn't.** The live paths are:

```
POST /trips/{id}/ai-import     → trip_ai.structure_document()       ← ONE call
POST /trips/{id}/ai-documents  → trip_ai.extract_document_records() ← ONE call
```

Pass 2 is reachable only through `POST /trips/ai-enhance`, which has **zero frontend callers**.

Production-unreachable as a result: the `/trips/ai-enhance` endpoint, `enhance_trip()`,
`enhance_trip_import()`, `_trip_import_to_ai()`, and the entire `_ENHANCE_SYSTEM` prompt.

Delete them, or wire the endpoint up. A dead OpenAI prompt in the tree is a trap for whoever eventually
"fixes" it without realising nothing calls it. (`full_report.md` needs the same correction.)

### R18 🟡 Magic strings alongside the enums that exist to replace them

`TripStatus` and `PointType` exist, and are then bypassed:

```python
return trip.status != "new"     # trip_ai_import.py:98
"departure",                     # detail_points.py:235
```

The frontend scatters the same literals with no shared constant:

```jsx
trip?.statusIntent === 'active'   // TripStatusMenu.jsx
trip.status === 'active'          // TripsPage.jsx
trip?.status === 'active'         // HomePage.jsx
```

Cheap to fix; R12 (OpenAPI-generated types) would fix the frontend half for free.

### R19 ✅ Two point serializers, one N+1-safe and one not — *fixed*

`trip_points.py` has both `_load_point_responses()` (batched — 4 queries total) and `_load_point_response()`
(per point — 5 queries *each*). The singular one is only safe because it is currently used on single
records. It is a loaded gun sitting next to the safe one.

### R20 🟡 `tzid_from_coords` is CPU-bound and runs on the event loop

`timezonefinder.timezone_at()` is a polygon lookup. With `in_memory=True` it is fast (single-digit ms), so
this is fine *today* — but it is synchronous, runs on the event loop, and is called in a loop when
resolving multiple locations. Worth knowing; not worth fixing yet.

### R21 🟢 Things I checked that are fine

- **No SQL-injection surface** — everything goes through SQLAlchemy; zero f-string SQL.
- **`ai.log` is not committed** and is gitignored. (My first check suggested otherwise; I was wrong.) It
  does contain message contents and locations, so it stays a deploy-time concern, not a repo one.
- **CORS** is an explicit origin list, not `*`, with `allow_credentials`. Correct.
- **Password handling** is fastapi-users' bcrypt with a timing-safe unknown-email path. Correct.
- **`.env` is gitignored**; `.env.example` is committed with no real secrets. Correct.

---

## Simplification opportunities

Ranked by (lines removed × risk removed) ÷ effort.

| # | Simplification | Removes | Effort |
|---|---|---|---|
| **S1** | **One domain layer behind both doors** (R4). `services/trip_write.py` owns the rules; the executor and the routers become adapters. | The entire class of R1/R2/R3 bugs. | 2–3 days |
| **S2** | **Table-drive `execute_action`** (R5): a `TargetSpec` per entity, one generic create/update/delete. | ~350 lines from a 739-line file. | 1 day |
| **S3** | **Delete the four hand-written forms** (R14); drive them from `FIELD_SPECS` + `ChatFormCard`, which already exist and already work. | ~1,000 lines of JSX. | 2 days |
| **S4** | **Generate frontend types from OpenAPI** (R12). One npm script. | Makes a whole bug class impossible. | 2 hours |
| **S5** | **Collapse `TravelDetail`/`Import`/`Patch`** (R6) into one field list plus generated variants; same for stay and point. | ~150 lines of `schemas.py`; the 8-file edit becomes a 3-file edit. | half a day |
| **S6** | **Delete the dead enhance pipeline** (R17). | ~120 lines, one prompt, one endpoint. | 1 hour |
| **S7** | **Fold `profileService` / `tripImportService` into `apiSlice`** (R13). | The axios layer and a duplicate 401 handler. | 2 hours |
| **S8** | **Extract hooks from `TripChatOverlay`** (R15). | Makes a 607-line component reviewable. | half a day |

---

## What shipped (S1)

**`app/services/trip_write.py`** — the one place trip content is written. It owns timezone inference,
UTC derivation, Google Places resolution, generated-point syncing, `promote_to_draft`, day adoption,
the derived-point guards, and the `model_fields_set` semantics that let an explicit `null` clear a
column. **Six** callers adapt to it and none of them contains a rule:

| caller | was | now |
|---|---|---|
| `services/trip_action_executor.py` | 739 | **343** — a per-target table + the model-specific plumbing (id coercion, date prose, refusals-as-tool-results) |
| `routers/trip_details.py` | 454 | **220** |
| `routers/trip_points.py` | 487 | **285** |
| `routers/trip_days.py` | 145 | **118** |
| `routers/trip_import.py` | 268 | **153** |
| `routers/trip_ai_import.py` | 589 | **524** |

Every rule now greps to exactly one file. `WriteError` / `ConflictError` carry their own HTTP status,
so one exception handler in `main.py` gives the same refusal the same status everywhere, while the
executor turns it into a tool result the model can act on.

**Two divergences I had not even found in the review** turned up during the work and are also fixed:

* Google Places resolution ran in the executor but **not** the routers — so airport names typed into
  the new-trip wizard ("ORD") were written with no coordinates at all. The import now resolves too:
  *"4 imported airports now have coordinates"*.
* `normalize_stay_wall_clock` (a date-only check-in means 4pm, not midnight) ran in the routers but
  **not** the executor, so `"check in on the 30th"` from the assistant landed at midnight.

**Verified**: 302 pytest tests (17 new in `test_trip_write.py`, which drive the *same* scenario through
both doors and compare the rows), 15/15 live evals, and a browser drive against the real model:

```
PASS  a fresh trip starts as status="new"
PASS  R1 ✓ a chat-created stay promoted the trip to "draft" — an itinerary upload can no longer wipe it
PASS  R2 ✓ the stay is on Asia/Tokyo — the venue's clock, not UTC
PASS  R2 ✓ the check-in point: wall clock 2026-10-30T16:00 → startUtc 07:00Z (JST is UTC+9)
PASS  R3 ✓ "remove it" actually removed it — the assistant no longer says done and does nothing
PASS  both doors agree: form stay is also Asia/Tokyo
PASS  itinerary import: 4 flights, 4 departures + 4 arrivals, no duplicate days
PASS  bonus: 4 imported airports now have coordinates
```

---

## What shipped (R8, R9, R11, R19)

### R8 — the frontend tests gate a merge

`ui/package.json` gained `"test:run": "vitest run"` (the bare `vitest` watches, and a watcher in CI hangs
until the job times out), and the `frontend` job runs it between lint and build.

### R9 — ruff and mypy, both clean, both gating

`api/pyproject.toml` configures both, `requirements-dev.txt` pins them exactly (a floating minor that adds
a rule turns an unrelated PR red), and a new `static` CI job runs them. It needs no database, so it does
not wait behind the Postgres container.

**ruff** — `E, W, F, I, UP, B, ASYNC, C4, RUF`. First run: **526 findings**. 494 were auto-fixed
(`X | None` over `Optional[X]`, `list` over `List`, import sorting, `datetime.UTC`). The rest were
hand-fixed, and a few were real:

* **ASYNC230** — the eval runner opened its report file with blocking `open()` inside an `async def`.
* **B904** ×13 — `raise HTTPException(...)` inside an `except` with no `from`, discarding the cause. Now
  each one either chains (`from exc`, where the cause is the diagnostic) or suppresses deliberately
  (`from None`, where it is expected control flow — an already-registered email, a duplicate request id).
* **B905** ×5 — `zip()` with no `strict=`. Now explicit, with a note on why `strict=False` is right there.

**mypy** — non-strict but `check_untyped_defs`. First run: **153 errors**. 105 of them were Pydantic
`__init__` false positives, killed by the `pydantic.mypy` plugin. (SQLAlchemy needs no plugin: the models
use 2.0 `Mapped[...]` annotations, which mypy reads directly. Its own plugin is deprecated anyway.) Of the
remaining 48, most were annotation debt — but **four were latent bugs**:

* `date_normalizer.py` — the trip-range check on a `"Oct 30"` style date was **dead code**: both branches
  returned the identical value, so the whole block had no effect. Deleted, with a comment saying why
  snapping a date into range would be wrong anyway.
* `chat_tool_loop.py` ×2 — `msg` is initialised to `None` and only set by the stream's final event. If the
  stream died mid-flight, the next line raised `AttributeError: 'NoneType' has no attribute 'tool_calls'`.
  Same shape in `chat.py` with `outcome`. All three now fail with a sentence that says what happened.
* `trip_ai_import.py` — `_ai_import(trip=None, db=None)` relied on an unwritten rule that the two are
  always passed together. Now it tests both.
* `dependencies.py` — `require_owned_trip` was annotated `-> TripRecord` while returning `TripRecord | None`.

Two incidental wins: `trip_import.py` was re-fetching a `TripDayRecord` it had inserted moments earlier
just to get it back out of the identity map — it now keeps the record. And `trip_action_executor.py` had
two different variables called `patch` in one function.

### R11 — 29 component tests, where there were none

`@testing-library/react` was installed and unused. Now:

| component | what the tests pin |
|---|---|
| `NextUpCard` | 10 — the confirmation number is one tap from the screen, the copy button copies it, and **"be at the airport by…" appears on a departure but never on an arrival** |
| `WhatsNextView` | 7 — the thing happening *now* beats the thing that is merely next; ticking one off sends `completed: true` |
| `TripGapsBanner` | 7 — it never renders an empty "0 things missing" alert; "1 thing missing", not "1 things" |
| `ChatChoiceCard` | 6 — a picked place sends **only** an `optionId` or a `placeId`, never coordinates |

Those are the two bugs that shipped (`"in 4h 60m"`, the airport hint on an arrival) and the property that
keeps the model from inventing geography. I confirmed the tests bite rather than passing vacuously by
reintroducing the arrival bug into `tripClock.js` and watching that one test — and only that one — fail.

### R19 — one point serializer

`_load_point_response()` (5 queries for a single point) was a second, hand-written implementation of
`_load_point_responses()` (4 queries for any number). It is now a three-line wrapper over the batched one.
Two loaders for one response shape meant two places for the soft-delete filter to be forgotten.

**Verified**: ruff clean, mypy clean (0 errors, 45 files), 302 pytest, 88 frontend tests, 15/15 live evals.

> **One thing this turned up, for the record.** The first full eval run came back **14/15**:
> `partial-capture-flight` failed, then passed 4/4 in isolation and 15/15 on a second full run. Nothing
> the model reads had changed (the system prompt and every tool description are byte-identical; the eval
> diff is pure `Optional[X]` → `X | None`), so this is nondeterminism, not a regression.
>
> It is nondeterminism the eval *invites*, though. `partial-capture-flight` asserts the reply
> **`message matches /\?/`** — a literal question mark. The model had answered *"If you want, I can add
> when you arrive…"*, which is the right behaviour phrased as an offer instead of a question. **That is an
> assertion on wording**, which is the one thing [this harness is praised above for never
> doing](#what-is-genuinely-good). Worth rewriting to assert the structural consequence (the turn ends
> without a completed travel leg and with `complete=false`) rather than the punctuation. Left alone here:
> loosening an eval while changing the code it guards is how a real regression gets waved through.

---

## Priority roadmap

**~~This week — stop the bleeding~~ ✅ done**

1. ~~**R1**~~ ✅ — `promote_to_draft` now lives in the write layer; every door calls it.
2. ~~**R2**~~ ✅ — timezone inference likewise. The executor resolves the place and uses its coordinates.
3. ~~**R3**~~ ✅ — `exclude_unset` instead of `exclude_none`, end to end.
4. ~~**S1 / R4**~~ ✅ — the single domain layer. 1–3 cannot recur.
5. ~~**S2 / R5**~~ ✅ — the executor is table-driven and 343 lines.

**~~Next — the safety nets~~ ✅ done**

6. ~~**R8**~~ ✅ — `test:run` added; the frontend suite gates a merge.
7. ~~**R9**~~ ✅ — ruff + mypy, both clean, both in CI, both pinned.
8. ~~**R11**~~ ✅ — 29 component tests across the four screens that keep breaking.
9. ~~**R19**~~ ✅ — one point serializer, not two.

**Next**

10. **R10** — pin and lock the Python dependencies. *(The last open item from the original top 10, and now
    the only unfixed one. `ruff` and `mypy` are pinned exactly; the other 14 are still `>=`.)*

**Then — pay down**

11. **S4** — OpenAPI → TypeScript types.
12. **S3** — delete the hand-written forms (`FIELD_SPECS` + `ChatFormCard` already do the job).
13. **S5 / S6 / R16 / R17 / R18** — schema collapse, dead code, dangling references, magic strings.
14. **The brittle eval** — `partial-capture-flight` asserts on a question mark; make it structural.

---

## Closing note

The previous review's criticism was *"your safety nets are all disabled."* They aren't any more — the test
suite is real and good, and the eval harness is better than most teams ever build.

This review's criticism is narrower and more structural: **you built the right rules, and then wrote them
down in two places.** Every serious bug in this document is a consequence of that one decision, and every
one of them arrived as a *correct fix applied to only one of the two doors* — which is precisely what that
shape of code guarantees will keep happening.

Fix R1–R3 this week, because they can lose a user's data. Then do S1, and they cannot come back.

**Both of those are now done.** The rules have one home, the two doors are adapters, and the three bugs
are gone — not patched, but made unrepresentable. What is left (R8–R11) is safety nets and hygiene,
not correctness.

---

*"Explain R#" or "just fix R#" are both fair game.*
