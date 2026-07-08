# Timezones In PriPriTrip

## Purpose
This document describes how timezone and date-time values are currently handled across the PriPriTrip backend and frontend, what libraries are involved, where behavior is inconsistent, and recommended patterns for reliable multi-timezone support.

## Executive Summary
Timezone handling is currently mixed:
- Some UI flows preserve wall-clock times by stripping offsets for display.
- Other UI flows parse ISO strings directly and may shift times to the viewer's local timezone.
- Point editing includes a timezone selector and builds ISO strings with offsets.
- Stay/travel editing currently stores datetime-local strings without an explicit timezone offset.
- Backend stores business event times as plain strings, not typed timestamps.
- Verification logic checks date coverage using date-only slices, ignoring timezone context.

This works for basic flows, but it is fragile for cross-timezone trips, DST boundaries, and users editing the same trip from different locales.

---

## Libraries And APIs Currently Used

### Frontend
- `dayjs` with plugins:
  - `utc`
  - `timezone`
  - `advancedFormat`
- Browser Intl APIs:
  - `Intl.DateTimeFormat`
  - `Intl.supportedValuesOf('timeZone')`
- Native JavaScript `Date`

Key references:
- [ui/src/utils/dayjs.js](ui/src/utils/dayjs.js)
- [ui/src/components/Forms/PointForm.jsx](ui/src/components/Forms/PointForm.jsx)

### Backend
- Python `datetime` (`datetime`, `timezone`) for audit timestamps like `updated_at` and soft-delete timestamps.
- Python `date` parsing for verification coverage checks.
- SQLAlchemy `DateTime(timezone=True)` for metadata columns (`created_at`, `updated_at`, `deleted_at`).

Key references:
- [api/app/models.py](api/app/models.py)
- [api/app/services/trip_verify.py](api/app/services/trip_verify.py)

---

## How Time Is Recorded Today

### 1. Business Event Times (trip content)
Fields such as:
- `TripPoint`: `startDateTime`, `endDateTime`
- `TravelDetail`: `departureDateTime`, `arrivalDateTime`
- `StayDetail`: `checkIn`, `checkOut`

are represented as **string fields** in schemas and DB models.

Backend schema examples:
- [api/app/schemas.py](api/app/schemas.py)

Backend model examples (stored as `String` columns):
- [api/app/models.py](api/app/models.py)

Implication:
- The system can hold multiple formats (`+02:00`, `Z`, or no offset) at once.
- There is no single enforced canonical timestamp representation.

### 2. Audit/System Times
Columns like `created_at`, `updated_at`, `deleted_at` use `DateTime(timezone=True)` and DB `NOW()` defaults.

References:
- [api/app/models.py](api/app/models.py)
- [api/app/routers/trip_points.py](api/app/routers/trip_points.py)
- [api/app/routers/trip_details.py](api/app/routers/trip_details.py)

Implication:
- Audit timestamps are timezone-aware and generally UTC-safe.
- Business event timestamps are not equally standardized.

### 3. Date-Only Fields
Trip-level and day-level fields (`startDate`, `endDate`, `date`) are date-only strings (`YYYY-MM-DD`).

Reference:
- [api/app/schemas.py](api/app/schemas.py)

Implication:
- This is usually correct for schedule-day semantics.
- Must not be treated as timezone-convertible instants.

---

## Current Frontend Timezone Behavior

### PointForm (most timezone-aware form)
`PointForm` includes a timezone selector and builds ISO strings with numeric offsets.

- Reads local datetime by slicing stored ISO string.
- Lets user choose an IANA timezone.
- Builds output string with offset via Intl APIs.

Reference:
- [ui/src/components/Forms/PointForm.jsx](ui/src/components/Forms/PointForm.jsx)

Notes:
- This is currently the most deliberate timezone flow in the UI.
- It still stores only offset in the datetime string; timezone ID is not persisted with the event.

### StayForm / TravelForm
These forms use `datetime-local` values and `parseDateTimeLocal`, then PATCH/POST the raw local string (`YYYY-MM-DDTHH:mm`) without explicit offset.

References:
- [ui/src/components/Forms/StayForm.jsx](ui/src/components/Forms/StayForm.jsx)
- [ui/src/components/Forms/TravelForm.jsx](ui/src/components/Forms/TravelForm.jsx)

Implication:
- Timezone context can be lost for stay/travel edits.
- Two users in different zones may interpret the same values differently.

### Timeline and Detail Display
Some components intentionally preserve wall-clock display by stripping offsets before parse:
- `parseWallClock` in [ui/src/utils/dayjs.js](ui/src/utils/dayjs.js)
- Used in [ui/src/components/Timeline/PointTimelineItem.jsx](ui/src/components/Timeline/PointTimelineItem.jsx)
- Used in [ui/src/components/Timeline/PointDetailSheet.jsx](ui/src/components/Timeline/PointDetailSheet.jsx)

Other screens parse datetime directly with `dayjs(...)` and therefore may apply local conversion:
- [ui/src/pages/ImportSummaryPage.jsx](ui/src/pages/ImportSummaryPage.jsx)

Implication:
- The same event can display different clock times across pages.

---

## Current Backend Verification Behavior

Verification logic compares coverage by date and derives dates from datetime strings by taking the first 10 chars (`YYYY-MM-DD`).

Reference:
- [api/app/services/trip_verify.py](api/app/services/trip_verify.py)

Implication:
- Verification is robust for date coverage checks.
- Verification ignores actual timezone/offset semantics.
- Around midnight crossings across zones, date interpretation may not match user intent.

---

## Key Inconsistencies / Risks

1. Mixed datetime formats in persisted data
- Some values include offsets, some may not.

2. Different UI pages interpret the same timestamp differently
- `parseWallClock` (no conversion) vs direct `dayjs(...)` (conversion possible).

3. Timezone ID is not persisted with event records
- Offset alone cannot reconstruct historical timezone rules reliably across DST and timezone policy changes.

4. Business event times stored as strings
- No DB-level validation or normalization for datetime format.

5. Stay/travel forms do not currently preserve timezone context like PointForm does
- Editing can strip or alter temporal meaning.

---

## Best Practices For Multi-Timezone Systems

### Pattern A: Instant-first (recommended for operations)
Store:
- `event_at_utc` (timestamp in UTC)
- `timezone_id` (IANA zone, e.g., `Europe/Paris`)
- optionally `local_time_text` for exact user-entered label

Use when:
- Ordering, reminders, alarms, integrations, and cross-user consistency matter.

Pros:
- Deterministic ordering and comparison.
- Correct conversions for each viewer zone.

### Pattern B: Local-schedule-first (recommended for itinerary-like travel apps)
Store:
- `local_date` + `local_time` (+ optionally seconds)
- `timezone_id` for the place/context
- optionally derived `event_at_utc`

Use when:
- User intent is wall-clock local time at a location (check-in at 15:00 local).

Pros:
- Preserves human intent for travel plans.
- Handles wall-clock display naturally.

### Pattern C: Date-only for day buckets
Store date-only (`YYYY-MM-DD`) for trip/day grouping and labels.
Never convert date-only values across timezones.

---

## Recommended Target Model For PriPriTrip

Given the product domain (travel itinerary), use a hybrid of B + A:

For business event fields:
- Persist local datetime and timezone ID as authoritative schedule intent.
- Optionally persist derived UTC instant for sorting/query efficiency.

Suggested conceptual fields per time-bearing entity:
- `*_local` (ISO local, no offset) or split date/time fields
- `*_timezone` (IANA zone)
- `*_utc` (derived instant, optional but recommended)

For display:
- Default to itinerary wall-clock (local event timezone).
- Optionally show secondary viewer-local time in compact form.

For backend rules/verify:
- Continue date coverage checks using local date semantics from the event's timezone context.

---

## Practical Next-Step Refactor Plan

### Phase 1: Consistency and guardrails (low-risk)
1. Choose one display rule and apply it everywhere:
- either wall-clock everywhere for trip itinerary screens,
- or explicit conversion strategy with labels.
2. Standardize formatter helpers in one utility file.
3. Add schema/input normalization checks for datetime fields.

### Phase 2: Persist timezone intent for stay/travel/point
1. Add timezone ID fields in API schema + DB.
2. Update PointForm/StayForm/TravelForm to all capture timezone in same way.
3. Ensure API stores canonical form consistently.

### Phase 3: Optional derived UTC and migration
1. Add derived UTC columns for operational logic.
2. Backfill old records carefully:
- if offset exists, infer UTC from offset,
- if no offset, require fallback timezone policy.

### Phase 4: Verification and reporting hardening
1. Make verify rules explicitly timezone-aware where needed.
2. Add tests for DST boundary and cross-midnight cases.

---

## Quick Checklist For Ongoing Work

- Keep date-only and datetime semantics separate.
- Never assume missing offset means UTC.
- Always carry timezone ID for wall-clock itinerary events.
- Use one shared formatting/parsing strategy across screens.
- Add tests for:
  - same event rendered in different browser timezones,
  - DST transitions,
  - crossing midnight between origin/destination zones.

---

## File Inventory Used For This Report

Backend:
- [api/app/models.py](api/app/models.py)
- [api/app/schemas.py](api/app/schemas.py)
- [api/app/routers/trip_import.py](api/app/routers/trip_import.py)
- [api/app/routers/trip_points.py](api/app/routers/trip_points.py)
- [api/app/routers/trip_details.py](api/app/routers/trip_details.py)
- [api/app/services/trip_verify.py](api/app/services/trip_verify.py)
- [api/app/serializers.py](api/app/serializers.py)

Frontend:
- [ui/src/utils/dayjs.js](ui/src/utils/dayjs.js)
- [ui/src/components/Forms/PointForm.jsx](ui/src/components/Forms/PointForm.jsx)
- [ui/src/components/Forms/StayForm.jsx](ui/src/components/Forms/StayForm.jsx)
- [ui/src/components/Forms/TravelForm.jsx](ui/src/components/Forms/TravelForm.jsx)
- [ui/src/components/Timeline/PointTimelineItem.jsx](ui/src/components/Timeline/PointTimelineItem.jsx)
- [ui/src/components/Timeline/PointDetailSheet.jsx](ui/src/components/Timeline/PointDetailSheet.jsx)
- [ui/src/components/Timeline/DayTimelineItem.jsx](ui/src/components/Timeline/DayTimelineItem.jsx)
- [ui/src/pages/ImportSummaryPage.jsx](ui/src/pages/ImportSummaryPage.jsx)
- [ui/src/components/Map/TripMapModal.jsx](ui/src/components/Map/TripMapModal.jsx)
