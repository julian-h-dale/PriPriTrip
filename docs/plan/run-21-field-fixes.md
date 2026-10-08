# Run stage 21 — field fixes from the usability review

From [the 2026-10-07 review](../ui-review-2026-10-07.md), as Julian chose
them (2026-10-07):
- **Do:** Tonight shows check-out, not a past check-in (review §2);
  packing works offline (§4); Today is always where a trip opens (§9);
  the Back buttons on tool pages (§11); time and place in search results
  (§11).
- **Deferred:** documents offline (§1: the airline apps and Google Wallet
  already keep boarding passes); phone numbers (§3).
- **Elsewhere:** the data saver (§5) is [Run 20](run-20-data-saver.md); light
  mode (§6) is [Run 22](run-22-light-mode.md).

**Status: planned.** All questions answered (2026-10-07).

## Where we are

- **Opening a trip:**
  - Signing in (`/`) lands on the active or next trip's **Today** (a
    viewer's on its timeline: viewers have no Today tab, Run 17).
  - A trip card on the trips list opens `/trips/:id`, the **Timeline**.
  - Importing a trip opens its timeline too.
- **Tonight** (`features/today/TodayPage.jsx`, `todayView.tonight`): the
  stay you sleep in tonight, always with "Check-in Tue, Oct 6 · 2:00 PM",
  even on night 3. On check-out day a line above it already says "Check
  out of … by 11:00 AM".
- **The Back button on tool pages** looks pressed (grey) when the page
  opens. The cause is touch "sticky hover": you tap ☰ at the top left, pick
  a tool, and the new page's Back button sits under the same finger
  position, so the phone keeps it in `:hover` (`hover:bg-accent`) until the
  next tap elsewhere. It affects every icon button with a hover fill, not
  only Back; tool pages are just where it shows.
- **Search results** show the entry's title and, when it wasn't the title
  that matched, which field did ("Confirmation: LX7Q2K"). No time, no place.
- **Packing** isn't saved on the phone: offline, the page says it needs a
  connection, and ticks can't be made.

## Design

### 1. A trip opens on Today (Q-F1)

- A trip card opens `/trips/:id/today` for owners and editors of an
  **active or upcoming** trip. Before it starts, Today previews Day 1 ("Day 1
  plan"), useful for the last check.
- A **past** trip's card opens its timeline: nothing is "today" any more.
- A viewer's card opens the timeline, as now (viewers have no Today tab).
- Importing a trip follows the same rule.

### 2. Tonight: check-out once you're checked in

The stay line under the name depends on the night:
- **The check-in night:** "Check-in today · 2:00 PM", as now.
- **Any later night:** "Check-out Mon, Oct 12 · 11:00 AM" (with "(Zurich
  time)" when the zone differs, as now).
- **Check-out day:** unchanged: the "Check out of … by 11:00 AM" line at
  the top, then tonight's next stay (or "No stay booked for tonight").

### 3. No sticky hover on touch

Tailwind 3.4's `future.hoverOnlyWhenSupported` makes every `hover:` style
apply only on devices that really hover (`@media (hover: hover)`). One
line in `tailwind.config.js`, and it fixes the Back button and every other
hover fill at once. Keyboard focus keeps its ring (`focus-visible`). On a
laptop nothing changes.

### 4. Time and place in search results

Under each result's title, a second line in the timeline's own words:
- **Activity:** its time and place, "10:00 AM · Varvakios Central Market"
  (either alone when only one is known).
- **Stay:** "Check-in 2:00 PM · Plaka".
- **Travel:** "5:40 PM · SWISS LX 9".

When the match wasn't the title, the "Confirmation: …" line stays, below.
Times are wall-clock values shown as written (`shared/utils/time.js`).

### 5. Packing offline

Like the journal:
- **Saved on the phone** as it loads (`tripCache`, per user and trip), so
  the list opens offline with the amber bar's "saved copy" note.
- **Changes wait on the phone:** ticks, adds, edits and deletes go into a
  packing queue (IndexedDB, like the journal outbox, merged per item so
  only the last state is sent) and go out when the connection is back.
  The list shows them straight away.
- **Suggestions** need the server: "Start from suggestions" is off while
  offline, with "Needs a connection".
- With the Run 20 switch on, see Q-D6 there.

## Phases

- **Phase 82 — Today first, and Tonight's check-out.**
  - **Scope:** trip cards and import open Today for active and upcoming
    trips (past trips and viewers: the timeline); Tonight's check-in /
    check-out line.
  - **Tests:**
    - An owner's and an editor's card for an active or upcoming trip links
      to Today; a past trip's and a viewer's to the timeline.
    - Tonight on the check-in night, a middle night, and check-out day.
- **Phase 83 — sticky hover and search results.**
  - **Scope:** `hoverOnlyWhenSupported`; the search result's second line.
  - **Tests:**
    - The built CSS wraps `hover:` rules in `@media (hover: hover)`.
    - Each kind of result shows its time and place; the matched field
      still shows.
  - **E2E:** at 375 px with touch: open a tool from ☰; the Back button
    isn't filled. Search screenshots.
- **Phase 84 — packing offline.**
  - **Scope:** saved list; the packing queue and its sync (with the
    journal's: when back online and when the app comes to the front);
    suggestions off while offline.
  - **Tests:**
    - Offline: the saved list shows; a tick, an add and a delete show at
      once and are queued; back online they're sent once, in order.
    - A tick then untick of the same item sends only the last state.
  - **E2E:** offline, tick and add; online again, the server has them.

## Built

- **Phase 82 ✅ (2026-10-07).** `tripHomePath` (shared/utils/tripDates.js) is
  the one rule for where a trip opens: trip cards, importing and signing in
  all use it. Tonight shows "Check-out Mon, Oct 12 · 11:00 AM" after the
  check-in night. E2E `field-fixes.spec.js` (uses the demo trip, so re-seed
  on the day).
- **Phase 83 ✅ (2026-10-07).** `future.hoverOnlyWhenSupported` in
  `tailwind.config.js`; a unit test builds the CSS and checks hover rules sit
  in `@media (hover: hover)` (it fails without the flag). The e2e puts the
  pointer over a tool's Back button in a touch-phone context and checks it
  stays clear; checked both ways (filled without the fix). Search results
  have a second line: "12:15 PM · Altes Tramdepot Brauerei", "2:00 PM ·
  Bern", "5:40 PM · SWISS LX 9"; the matched field still shows under it.

## Open questions

- **Q-F1. A past trip's card: Today or the timeline?** Today on a trip that
  isn't under way previews Day 1.
  - (a) *Recommended:* Today for active and upcoming trips (Day 1 preview
    before it starts is useful for the last check), the **timeline** for
    past trips (nothing is "today" any more; you're looking back).
  - (b) Always Today, as asked, past trips included.
  - **Answer:** (a) (Julian, 2026-10-07). Today for active and upcoming trips; the timeline for past ones.
