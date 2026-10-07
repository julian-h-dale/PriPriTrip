# Run stage 2 — "find it fast": Today tab, landing, drawer, details, search

From `ui_review.md`, discussed with Julian on 2026-10-03.

**Decisions** (2026-10-03):
- **Landing.** The app opens on the next trip that matters: the active one,
  else the next upcoming one, on its **Today** tab. With no such trip it
  opens the trips list.
- **Navigation.** The trips list moves to `/trips`, behind a **nav drawer**
  (☰). The drawer holds All trips, Install app, Admin (for admins) and Sign
  out.
- **The tab bar is stable: Today | Timeline | Map.** Map stays a tab, not a
  drawer item.
- **Today is always shown for now**, so it's easy to test. When the trip
  isn't under way, it previews the trip's **first day**, and says so.
  Hiding the tab outside an active trip is a later switch on the whole
  view.
- **Today shows, in order:**
  1. **Next up:** the next booking or timed activity, with its key facts,
     the confirmation number (with copy) and Directions.
  2. **Tonight:** that night's stay, plus this morning's check-out on a
     changeover day.
  3. **Today's plan:** that day's entries.
  4. A link to **tomorrow**.
- **Past days are greyed** on the timeline, and today's row is marked
  "Today". Entries *within* a day are **not** greyed, because many
  activities have no time.
- **Details are reorganized, and the list rows don't change.** One shared
  `EntryDetails` component is used by the day page's expanded entries, the
  stays/travel quick look and the Today tab. Its order:
  1. booking facts and the **confirmation number** at the top;
  2. notes;
  3. places (address and open-in-maps);
  4. photos last, as small thumbnails;
  5. no photos for travel endpoints.
- **Search** is an icon in the trip's top bar. It opens a full-screen search
  over the whole trip: titles, notes, confirmation numbers, carriers,
  numbers, place names and addresses. Results are grouped by day, and
  tapping one opens that day with the entry expanded. It's all on the
  device, so it works offline.
- **Day page:**
  - "Day N of M";
  - prev/next at the bottom too;
  - swipe left/right between days;
  - the "← Trip" link is dropped (the top bar and the Timeline tab cover
    it).
- **Trip header:** a "Plan | Stays | Travel" segmented control replaces the
  House/Plane icons. Julian sees before/after screenshots and may revert
  it.
- **Trips list:** grouped Active (hidden when empty), then Upcoming
  (soonest first), then Past (most recent first, collapsed behind "Past
  (n)"). Delete moves into a "⋯" menu.
- **Tidy-ups:**
  - the "Times are local (… unless noted)" header line is dropped;
  - "Open map" and "Website" links get a full-size tap target.
- **Dropped:** "Locate me". Directions hand off to the phone's maps app,
  which already shows where you are and works offline.
- **Next follow-up:** a text-size preference that also scales the timeline
  rails and dots.

### Phase 20 — Run: landing, drawer, trips grouping ✅

- `/` resolves to a trip (`pickLandingTrip` in `tripDates.js`) and redirects
  to its Today tab, or to `/trips` when there's none. `TripsPage` moves to
  `/trips`.
- `TopBar`, with ☰ and a title, on the trip pages and the trips list.
  `NavDrawer` is a hand-rolled slide-in panel in the dialog's shadcn shape.
  Install, Admin and Sign out move into it.
- Trips grouped by `tripPhase`; Past collapsed; delete through a "⋯" menu
  (with the same confirm dialog as before).
- The tidy-ups: the header line, and the link tap targets.
- **Tests:**
  - `pickLandingTrip` (active, then the next upcoming, then none);
  - the grouping and its order;
  - Past collapsed;
  - delete through the menu;
  - the drawer's links;
  - `/` redirects.

### Phase 21 — Run: the Today tab and greyed past days ✅

- `/trips/:id/today` and a third tab.
- `todayView.js` (pure):
  - `referenceDay(trip, now)` gives `{ date, active }`: today on the trip's
    calendar while it's under way, else the first day (the preview).
  - `nextUp(trip, ref, now)` finds the next stay check-in or check-out,
    travel departure, or timed activity at or after "now". Each one is
    compared on its own place's clock. A preview starts at 00:00 on the
    first day.
  - `tonight(trip, date)` gives that night's stay and any check-out that
    morning.
- `DayRow` takes `past` and `today` flags.
- **Tests:**
  - `todayView` unit tests: a cross-zone "now", a preview, a changeover
    day, nothing left today;
  - `TodayPage` component tests;
  - greyed rows.

### Phase 22 — Run: shared EntryDetails, reordered ✅

- `EntryDetails` (facts, then confirmation, then notes, then places, then
  thumbnails) used in `TimelineEntry`, `BookingDetailsDialog` and Today.
  `LocationBlock` becomes `PlaceRow`, a compact place row with a 64px
  thumbnail. The mini-map fallback is gone from the details; it's still in
  `PlaceField` while picking. The facts gain Room (stays) and Seat (travel),
  and a leg without an arrival says "Not set yet".
- **Tests:** the order of the sections, no photo for travel endpoints, and
  the existing editing and coverage tests still pass.

### Phase 23 — Run: trip search ✅

- `tripSearch.js` (pure) searches the timeline entries.
- `TripSearch` is a full-screen overlay opened from the top bar.
- `?open=<entry key>` on the day page expands the entry and scrolls to it.
- **Tests:** matching each field, grouping by day, an empty result, and the
  deep link opening the entry.

### Phase 24 — Run: day navigation and the segmented control ✅

- "Day N of M", prev/next at the top and bottom, swipe (a touch handler
  with a distance threshold; vertical scrolling isn't hijacked). The
  "← Trip" link is dropped.
- The "Plan | Stays | Travel" segmented control, with before/after
  screenshots.
- **Tests:** the day counter, the bottom links, swipe navigation (touch
  events), and the segmented control's pressed state.

Each phase: `make verify` green, a live Playwright pass with screenshots at
375px, PROGRESS updated, a commit.

**Built (2026-10-03):** all five phases, one commit each.
- `make verify`: 115 API + 196 UI. `ui/e2e/trip.spec.js` (10 tests) passes
  live.
- The timeline page keeps the trip name as its heading, so its top bar
  doesn't repeat it (`showTitle={false}`). The other trip pages show it in
  the top bar.
- Swipe ignores touches from the portaled edit dialogs (React bubbles
  portal events), so swiping inside a form never changes the day.
- Before/after of the segmented control:
  `ui/e2e/screenshots/compare-segmented-control.png` (gitignored, local
  only). Julian may revert it.
- **Waiting on:** Julian's look at 375px.
