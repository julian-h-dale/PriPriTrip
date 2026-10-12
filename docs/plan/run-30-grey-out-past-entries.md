# Run stage 30 — grey out what's already happened

Julian (2026-10-12): grey out a day's entries once their time has passed,
judged in the trip's time zone. For example, on the Athens trip at 11:30
in Athens, an 11:00 check-out shows greyed out.

**Status: answered; building.** Branch `grey-out-past-entries` (off `main`
at `e8e0d06`, after Run 29's merge).

## Where we are

- **Only whole days grey out today.** On the timeline, a day before today
  (on the trip's own calendar, `todayIn(trip.timezone)`) is drawn at
  `opacity-55` with a muted dot (`DayRow`'s `past`). Nothing *inside* a
  day greys: the day page (`DayDetailPage`) and the Today tab's "Today's
  plan" both render entries through `TimelineEntry`, and it has no notion
  of time passing.
- **Everything needed to judge "has it happened" already exists.**
  - `describeEntry(entry, trip)` gives each entry's `start`, `end`, `zone`
    and `endZone` (a flight's arrival can be in another zone). That covers
    activities, check-in, check-out, departures and arrivals.
  - `wallToInstant(wall, zone)` turns a wall-clock time into a real
    instant.
  - The Today tab's "Next up" (`todayView.nextUp`) already uses both to
    skip what's started.
- **The timeline's day rows don't list entries,** so only the day page and
  Today change.

## Design

### When an entry counts as done

Each entry is judged on **its own place's clock** (Q1: consistent with
"Next up"). That's the scheme
the app already uses: a check-out uses the hotel's zone, and a flight's
landing uses the arrival city's zone. Where nothing says otherwise, the
zone falls back to the trip's. On the Athens trip they're the same thing:
at 11:30 Athens time, the 11:00 check-out is done.

| Entry | Done when |
|---|---|
| Activity with a start and an end | its end has passed |
| Activity with only a start | its start has passed (Q2), as "Next up" moves on |
| Check-in, check-out | that time has passed |
| Departure, same day (it shows the arrival too) | the arrival has passed |
| Departure, overnight | the departure has passed |
| Arrival | the arrival has passed |
| Untimed activity, "Staying at" | only once the whole day is over |
| Anything on a day before today | done |

"Staying at" rows are already muted and don't change.

### How it looks

- Done entries get the same treatment as a past day row: the row at
  `opacity-55`. It stays tappable, and the icon and text are unchanged
  apart from the fade, so it's still readable (`design_doc.md`: muted, not
  hidden).
- **The list updates by itself.** The page re-checks every minute while
  it's open, so the check-out greys at 11:00 without a refresh. That uses a
  shared `useNow(interval)` hook. `TripsPage` and `ClocksPage` each have
  their own copy today; they move to `shared/hooks/useNow.js`.
- **Where:** the day page, including a plan B list, and the Today tab's
  "Today's plan". The Today tab's preview of Day 1, before the trip starts,
  has nothing done.

### Where "now" comes from

The phone's clock, as a real instant (`Date.now()`), compared with each
entry's instant. The phone's own time zone doesn't matter: in Chicago,
looking at the Athens trip, the check-out still greys at 11:00 Athens time.
Offline works the same way: it only needs the saved trip.

## Phases

### Phase 104 — done entries grey out

Frontend only.

- `timeline/entryDone.js`: `isDone(entry, trip, now)`, a pure function
  implementing the table above (`describeEntry` + `wallToInstant`, end in
  `endZone`).
- `shared/hooks/useNow.js` (moved from `TripsPage` / `ClocksPage`).
- `TimelineEntry` takes `done`. `DayDetailPage` and `TodayPage` work it out
  per entry with `useNow(60_000)`.

**Tests**

- `isDone` for each row of the table, including the Athens case (11:00
  check-out, 11:30 Athens time → done; 10:59 → not done).
- A different phone zone gives the same answer (the same instant from a
  Chicago clock).
- A flight leaving Chicago and landing in Athens is judged by the Athens
  landing time.
- Untimed: not done during the day, done once the trip's day is over. Any
  entry on an earlier day is done.
- Day page: a done row is faded, the rest aren't. Moving the clock past
  the next time fades it with no reload (fake timers).
- Today tab: the same; the Day 1 preview fades nothing.
- `make verify` green; e2e screenshot of a day page part-way through,
  with a fixed clock (Playwright's `page.clock`). A human looks at it on a
  phone in both themes.

**Effort:** small. One phase: about a 40-line helper and its tests, a prop
on `TimelineEntry`, two call sites, and moving `useNow`. No server change,
no migration.

## Open questions — answered (Julian, 2026-10-12)

1. **Whose clock?** → Each entry's own place, falling back to the trip's
   zone: keep it consistent with "Next up".
2. **An activity with only a start time** → greyed as soon as it starts.
3. **Untimed activities today** → stay bright all day.
4. **The timeline's day rows** → no change.
5. **Branch** → `trip-settings` is merged; a new branch off `origin/main`.
