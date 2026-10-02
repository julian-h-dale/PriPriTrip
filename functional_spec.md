# Functional Spec — PriPriTrip

## 1. Goal

PriPriTrip shows a trip as a clean, day-by-day timeline you can read on your
phone while travelling. A trip is described by **one JSON document**. You upload
it, and the app renders it. This is a fresh start on `project-template` that
carries over v1's lessons (see `docs/lessons_learned.md`).

## 2. Non-Goals (for now)

- Editing the trip header (name, dates, default timezone) in the app.
  Activities, days, stays and travel are all editable.
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
| **Travel** | One booked/scheduled leg: flight, train, bus, ferry, car. Lives at trip level, **not** inside a day; the timeline places it by its departure time. | title, mode, depart (wall-clock, required), arrive?, departTimezone?, arriveTimezone?, from?, to?, carrier?, number?, confirmationNumber?, notes? | trip |
| **Day** | One calendar date of the trip. At most one per date. | date, title, summary? (markdown) | trip |
| **Item** | One planned activity on a day. Incidental movement ("walk to the old town") is an activity, not a Travel. | title, start?, end?, timezone?, location?, confirmationNumber?, notes? (markdown) | day |
| **Location** | A place: a value embedded in a stay, travel (from/to) or item, not its own table. | name, address?, lat?, lng?, url? | its stay/travel/item |
| **Trip document** | The JSON file describing a whole trip (trip, stays, travels, days, and items). Validated by the published JSON Schema. | `schemaVersion: 1` | — |

**Timeline marker.** A row computed when the timeline renders, never stored:
check-in / staying / check-out from stays, and depart / arrive from travels. A
leg that lands on a later date shows an "Arrive" marker on that date too.

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
3. **View the timeline.** As a user, I open a trip and see it as a vertical
   timeline: one point per date from start to end on a rail down the left,
   with that day's card beside it.
   1. Each day's card is open by default and collapsible. It shows the title
      (or the date when untitled), the summary, and the entries: activities in
      the order written, with stay and travel markers merged in by time. A
      date with nothing on it is a slim point saying "No plans".
   2. A compact date strip stays at the top while scrolling. Tapping a date
      scrolls to its card, and the day in view is highlighted. The date is
      kept in the URL (`?day=YYYY-MM-DD`), so a reload or link lands on it.
   3. Tapping an entry expands its details: notes (markdown), location (with a
      maps link), confirmation number, and for travel, the mode, carrier,
      number and from → to. Times are shown as written, labelled with their
      place's zone when it differs from the trip's.
4. **Edit the trip's plans.** As a user, I can add, edit and delete
   activities, stays and travel, reorder a day's activities, and edit a day's
   title and summary.
   1. Each day card has an "Add" button offering Activity, Travel or Stay, and
      an "Edit day" button. An expanded activity offers Edit, Up/Down and
      Delete. An expanded stay or travel row offers Edit and Delete, which act
      on the booking itself (whichever of its rows you tap). Delete always asks
      first.
   2. **Places, not timezones.** Every place is picked from Google Places
      search and can be renamed after picking. The place decides which clock
      its times are on, shown read-only ("Times here are Zurich time"). Users
      only ever enter wall-clock times as written on the ticket or booking;
      there is no timezone picker. If place search is unavailable, a name can
      be typed by hand and times use the trip's clock.
   3. **Activity form:** title, day, start and end times (an end before the
      start means the next day), place (optional), link, confirmation number,
      notes. Moving an activity to another day puts it at the end of that day.
   4. **Travel form:** type (Fly/Train/Bus/Ferry/Boat/Car/Other); from
      (required) with departure date and time (required); to, with arrival
      date and time (enabled once "to" is picked); title (follows "From → To"
      until edited); carrier, number, seat; confirmation number; notes.
      - A missing arrival is allowed but shows a warning in the form and a "No
        arrival yet" badge on the timeline.
      - A leg whose ends are in different zones is spelled out: "Departs
        5:40 PM Chicago time · lands 9:25 AM Zurich time".
   5. **Stay form:** where (required), name, type, check-in and check-out dates
      and times (required, prefilled 15:00 / 11:00), room, confirmation
      number, link, notes.
   6. Every edit is checked by the same rules as an import; problems show next
      to the field.
5. **Get the schema.** The JSON Schema for the trip document is committed in
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
- **Whose clock is authoritative?** The place's. A time's zone comes from
  where it happens:
  1. its place's coordinates (offline lookup);
  2. else an explicit timezone written in an imported document;
  3. else, for an activity, that night's stay;
  4. else the trip's timezone.

  It is worked out when the trip is read, never stored, and never entered by
  the user. The viewer's browser timezone never changes what is shown.
- **Wall-clock times:** yes, all trip times (activity start/end, stay check-in
  and check-out, travel depart/arrive) are wall-clock values, displayed exactly
  as written. Trip and day dates are plain dates. Instants are used only for
  audit fields and for cross-timezone comparisons during validation.

## 7. Acceptance Criteria

- [ ] A published JSON Schema for the trip document exists and matches the
      backend's validation model (a test enforces this).
- [ ] Uploading a valid trip document creates a new trip every time.
- [ ] Uploading an invalid document creates nothing and returns every error
      with its path.
- [ ] The home screen lists the user's trips and has an empty state.
- [ ] The trip view shows every day on a vertical timeline; days and entries expand and collapse;
      notes render as markdown; stays show as computed markers.
- [ ] Wall-clock times render identically regardless of the browser's timezone.
- [ ] Activities can be added, edited, reordered and deleted; stays and travel
      can be added, edited and deleted; an invalid edit is rejected with the
      same rules and messages as an import.
- [ ] Users never pick a timezone: each time's zone is inferred from its place,
      and a cross-zone leg is checked and shown on each end's own clock.
- [ ] A user cannot see or delete another user's trip (404).
- [ ] Layout works at phone width (375px), dark theme, per `design_doc.md`.

## 8. Notes / Open Questions

- Julian will provide a real itinerary after the basic pages exist. It gets
  converted into a trip document and imported as the first real trip.
- Decisions already made (2026-10-01/02): stays **and travels** at trip level
  with their own rules (no stored derived points);
  markdown in notes and summaries; keep the template's login and per-user
  ownership; reject invalid imports for now (relax later); keep v1 material in
  `reference/`.
