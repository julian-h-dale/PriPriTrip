# Run stage 14 — swipe up and down between entries

Asked 2026-10-06 (Julian), on branch `details-page`: on an entry's page,
swipe vertically to the previous or next entry. Q-D7 put left/right swiping
off (the day page already swipes left/right between days); up/down doesn't
stack on that.

### Where we are

- `EntryPage` shows one activity, stay or leg, found by id. It doesn't know
  what's before or after it.
- The order is `buildTimeline(trip)`: days, each with `entries`. A stay is a
  check-in row, a "Staying at" row per night between, and a check-out row; a
  leg is a depart row and, when it lands on another day, an arrive row.
- The page scrolls inside `BottomNavLayout`'s `[data-scroll-root]`, so
  "at the top" and "at the bottom" are that one element's scroll position.
- `DaySwiper` already replaces the URL as you swipe, so Back isn't a list of
  every day passed.

### Design

**The order** (Q-S1): the trip's timeline, across days: every row in order,
except the "Staying at" filler rows, and a row is dropped when it's the same
page as the row before it (a leg's depart then its arrive on the same day).
A stay or leg can come up twice (check-in, check-out; an overnight leg's two
ends), so the page needs to know which of those it is: a row's link passes
its entry key (`atKey`) in the router state. Without it (a reload, a search
result, the map) it's the record's first row.

**Moving:**
- **Previous / Next rows** (Q-S4): "↑ Previous · *title*" at the top of the
  page and "Next ↓ · *title*" at the bottom, with the day when it's another
  one. Tapping one goes there. On the first and last entries of the trip the
  missing one isn't shown. (Kept for now, to try; may go later.)
- **The pull** (Phase 66): scroll as normal; at the bottom, keep pulling up
  and a "Next" card rises; let go past 80 px (Q-S3) to go there. At the top,
  pull down for Previous. A page shorter than the screen is at both ends.
  Off while a dialog is open; reduced motion changes entry without the
  slide.
- Each move **replaces** the URL, like the day swiper, and starts at the top
  of the new page.

**Back** (Q-S2): ← in the top bar goes to the trip timeline. The phone's own
back gesture still follows history (where you opened the first entry from).

### Phases

- **Phase 65 — Previous and Next on an entry's page.**
  - **Scope:** `entrySequence(trip)` and `neighbours()` in `entries.js`; rows
    pass `atKey`; the Previous / Next rows; replace on move, scroll to top;
    ← to the trip timeline.
  - **Tests:** the order crosses days, skips "Staying at" rows and a leg's
    same-day arrival; a stay's check-out row steps on from check-out; no
    Previous on the first entry, no Next on the last; another day's entry
    shows its day; a move replaces the URL; ← goes to the timeline.
- **Phase 66 — the pull.**
  - **Scope:** `useEdgePull` on the scroll root (only takes over at an edge,
    pulling outward; `overscroll-behavior-y: contain`); the peek cards; the
    slide; off while a dialog is open; reduced motion.
  - **Tests:** the threshold and edge logic as a pure function; a jsdom touch
    sequence: a pull at the bottom goes next, a short one springs back, a
    pull mid-page just scrolls.
  - **E2E:** Playwright with touch at 375 px; screenshots of the peek card.
    **A real phone too** (iOS rubber-banding inside a scroll area is what
    jsdom and desktop Chromium can't show).

### Built (2026-10-06): Phase 65

As planned. `make verify` green (246 API + 407 UI tests); e2e screenshots
`04c` (Next at the bottom of Dinner, naming Tue) and `04d` (Previous at the
top of the next page).
- The entry's view is keyed by kind and id: the page stays mounted as you
  move, and without the key Chromium kept the old photo until the new one
  loaded.
- The phone's back gesture still follows history; only ← goes to the
  timeline.

### Built (2026-10-06): Phase 66

As planned. `make verify` green (246 API + 418 UI tests); e2e drives real
touches through Chromium's DevTools protocol at 375 px (screenshots `04e`,
`04f`): a mid-page drag scrolls, a pull at the bottom goes next, at the top
previous, a short pull springs back.
- The page moves half as far as the finger (up to 80 px), so the 80 px
  threshold is finger travel.
- The hint ("Pull for next" → "Release for next") sits in the room the pull
  opens; the Previous / Next rows from Phase 65 stay.
- Not yet tried on a real phone (Julian away from his desk).

### Changed after trying it (2026-10-06, Julian)

- **The Previous / Next rows are gone** (Q-S4 revised): only the pull. With
  them gone, the pull's hint names the entry it goes to ("Release for next ·
  Tue, May 12" over "Morning at the Rose Garden").
- **← goes back where you came from** (Q-S2 revised), across the app: an
  entry's page back to the day (or search, Today, the map), else to the
  entry's day; the day page back to the timeline (or wherever), else to the
  timeline. The day page's ← moved from the top right into ☰'s place, like
  the tool pages; the drawer is a step back, on the timeline.
- **Swiping keeps "first page opened"** (`shared/utils/firstEntry.js`):
  React Router gives a replaced address a new key, so after swiping between
  days or entries on a page opened directly, ← thought there was history
  and went nowhere. A replace now carries `firstEntry` in its state.
- **A pull only starts from a touch that began at that end.** Before, one
  long scroll that reached the bottom carried straight on into the next
  entry (the e2e caught it once the rows were gone and Dinner's page was
  only 140 px taller than the screen). Now the scroll stops at the end and
  a fresh touch pulls on.

### Open questions (Run stage 14)

- **Q-S1. Across days, or stop at the ends of a day?** Recommendation:
  across days, showing the day when it changes.
  - **Answer:** across days; swiping past a day's last entry goes to the
    next day (2026-10-06).
- **Q-S2. Where does ← go?** The entry's day, or where you started?
  - **Answer:** the trip timeline (2026-10-06). **Revised:** back where you
    came from, else the entry's day; the day page likewise back to the
    timeline (2026-10-06).
- **Q-S3. How far to pull?** Recommendation: about 80 px.
  - **Answer:** 80 px is fine (2026-10-06).
- **Q-S4. Visible Previous / Next rows too, or the gesture only?**
  - **Answer:** add them; may remove them later (2026-10-06). **Revised:**
    removed (2026-10-06).
