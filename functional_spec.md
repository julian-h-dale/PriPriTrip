# Functional Spec — PriPriTrip

## 1. Goal

PriPriTrip shows a trip as a clean, day-by-day timeline you can read on your
phone while travelling. A trip is described by **one JSON document**. You upload
it, and the app renders it. This is a fresh start on `project-template` that
carries over v1's lessons (see `docs/lessons_learned.md`).

## 2. Non-Goals (for now)

- Editing a trip in the app (comes later via hand-written forms).
- Updating, merging or diffing an existing trip from an upload. **Every import
  creates a brand-new trip.**
- Any AI/LLM features: chat, document import, enhancement.
- Trip verification / gap detection (the knowledge is kept in
  `docs/lessons_learned.md`).
- Maps, Google Places lookup, share links, "What's Next" / active-trip mode,
  offline/PWA.
- Deployment changes. Local-only for now; the template's container setup stays
  untouched.

## 3. Domain Model / Glossary

All rows use UUID keys and soft delete, and are owned by a user (directly, or
through their trip).

| Entity | Description | Key fields | Owned by |
|---|---|---|---|
| **Trip** | One journey. | name, startDate, endDate, timezone (IANA, required) | user |
| **Stay** | One accommodation booking, spanning nights. Lives at trip level, not inside a day. | name, type (hotel/hostel/airbnb/rental/other), checkIn, checkOut (wall-clock), timezone?, location?, confirmationNumber?, notes? | trip |
| **Day** | One calendar date of the trip. At most one per date. | date, title, summary? (markdown) | trip |
| **Item** | One thing that happens on a day: an `activity` or a `travel` leg. | kind, title, start?, end?, startTimezone?, endTimezone?, location? (activity), from?/to? (travel), travel {mode, carrier?, number?}?, confirmationNumber?, notes? (markdown) | day |
| **Location** | A place: a value embedded in a stay or item, not its own table. | name, address?, lat?, lng?, url? | its stay/item |
| **Trip document** | The JSON file describing a whole trip (trip, stays, days, and items). Validated by the published JSON Schema. | `schemaVersion: 1` | — |

**Timeline marker.** A check-in, staying, or check-out row computed from stays
when the timeline renders. It is never stored.

## 4. Core User Flows

1. **Import a trip.** As a user, I can upload a trip JSON file to create a new trip.
   1. From the home screen, choose "Import trip" and pick a `.json` file.
   2. The file is validated against the trip schema and the import rules. If it
      fails, nothing is saved and I see the specific errors (for example
      `days[2].items[0].start: must be on 2026-05-12`).
   3. If it succeeds, a new trip is created (even if the same file was imported
      before), I see a success toast, and the app opens the trip.
2. **Pick a trip.** As a user, the home screen lists my trips (name, dates),
   soonest first. With no trips, it shows an empty state with the import action.
   I can delete a trip (soft delete, after a confirmation).
3. **View the timeline.** As a user, I open a trip and see its days in order.
   1. Each day shows its date and title, collapsed by default. Tapping it
      expands the day's summary and its items in time order, along with stay
      markers (check in, staying at, check out).
   2. Tapping an item expands its details: notes (markdown), location (with a
      maps link when there are coordinates or a URL), confirmation number, and
      travel details (mode, carrier, number, from → to).
4. **Get the schema.** The JSON Schema for the trip document is committed in
   the repo (`schema/trip.schema.json`) and served by the API, so a trip
   document can be authored and checked outside the app.

## 5. Roles & Permissions

- **User:** imports, views and deletes only their own trips. Another user's
  trip id returns 404.
- **Admin:** template default (`/admin/users` listing). No trip-specific admin
  features.

## 6. Time & Locale

- **Does the app have a notion of "today"?** Not yet. Nothing is
  clock-dependent in this scope.
- **Whose clock is authoritative?** The trip's. Every wall-clock value is
  interpreted in its own IANA timezone (an item or stay override, otherwise the
  trip's timezone). The viewer's browser timezone never changes what is shown.
- **Wall-clock times:** yes, all trip times (item start/end, stay check-in and
  check-out) are wall-clock values with an IANA zone, displayed exactly as
  written. Trip and day dates are plain dates. Instants are used only for
  audit fields and for cross-timezone comparisons during validation.

## 7. Acceptance Criteria

- [ ] A published JSON Schema for the trip document exists and matches the
      backend's validation model (a test enforces this).
- [ ] Uploading a valid trip document creates a new trip every time.
- [ ] Uploading an invalid document creates nothing and returns every error
      with its path.
- [ ] The home screen lists the user's trips and has an empty state.
- [ ] The trip view shows every day; days and items expand and collapse;
      notes render as markdown; stays show as computed markers.
- [ ] Wall-clock times render identically regardless of the browser's timezone.
- [ ] A user cannot see or delete another user's trip (404).
- [ ] Layout works at phone width (375px), dark theme, per `design_doc.md`.

## 8. Notes / Open Questions

- Julian will provide a real itinerary after the basic pages exist. It gets
  converted into a trip document and imported as the first real trip.
- Decisions already made (2026-10-01): stays at trip level with their own rules;
  markdown in notes and summaries; keep the template's login and per-user
  ownership; reject invalid imports for now (relax later); keep v1 material in
  `reference/`.
