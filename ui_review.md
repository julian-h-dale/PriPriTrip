# UI/UX review — "find it fast"

Reviewed 2026-10-03, after Phase 15, from the 375px Playwright screenshots
in `ui/e2e/screenshots/` and the code. The lens is the app's main use case:
**one place for everything you need on a trip, and you can find it fast.**

**Decided 2026-10-03 with Julian; scheduled as Run stage 2 (Phases 20–24)**
in `implementation_plan.md`. Each item below has its decision; mark them
done here as they land.

## What's working

- The dark theme is consistent and the contrast is good. It follows
  `design_doc.md`: 4px radius, borders instead of shadows.
- Collapsed day rows read well at a glance: date, cities ("Bern → Wengen"),
  then the bold title and summary.
- Each day has its own page, so the overview stays uncluttered.
- The stays and travel coverage views answer "which nights have a hotel?"
  visually.
- The bottom nav (Timeline / Map) is where a thumb expects it.

## Findings, by priority

### 1. Nothing knows "today" (highest impact) — ✅ done 2026-10-03

**Decision:** a **Today** tab: Today | Timeline | Map, Today first. For now it's always shown, and previews the first day when the trip isn't under way (easy to test); hiding it outside an active trip comes later. Next up includes timed activities. Past days are greyed on the timeline, but entries within a day are not, because many have no time. (Phase 21)

During the trip, finding tonight's hotel confirmation takes 4–5 taps: trips
→ trip → find the date → day → expand the entry → scroll.

- When a trip is under way, open straight to it. Skip the trips list, or
  pin the active trip at the top of it.
- Put a **Now / Next** card at the top of the active trip: the next travel
  leg (time, carrier and number, terminal), and tonight's stay (name,
  address, check-in time, confirmation number), each one tap from
  directions.
- Mark the "Today" row on the timeline and scroll to it on load.
- `shared/utils/tripDates.js` (`todayIn`, `tripPhase`, added in Phase 19)
  is the foundation for this.

### 2. Key details are hidden behind expanding — ✅ done 2026-10-03

**Decision:** keep drilling into the details; the list rows don't change (they got busy before). One shared `EntryDetails` component, ordered: facts and confirmation number, then notes, then places, then small photos last. No photos for airports and stations. The Today tab gives fast access without drilling. (Phase 22)

- Show confirmation numbers, the address and the check-in/departure time on
  the collapsed entry row, with tap-to-copy (the copy control already exists
  inside the expanded view).
- An expanded flight is mostly two large airport photos, which push the
  details below the fold. Make photos thumbnails, or drop them for travel
  endpoints: airport photos don't help you find anything.

### 3. Search exists only on the map — ✅ done 2026-10-03

**Decision:** a search icon in the trip's top bar opens a full-screen search. Results are grouped by day, and tapping one opens that day with the entry expanded. (Phase 23)

- Add a trip-wide search on the timeline that covers titles, notes,
  confirmation numbers, carriers and addresses (for example "SBB", "LX 9", a
  hotel name). It's a pure, local, offline-friendly function, like
  `markerSearch.js`.

### 4. The stays/travel toggles have no labels — ✅ done 2026-10-03

**Decision:** try "Plan | Stays | Travel". Julian gets before/after screenshots and may revert it. (Phase 24)

- The House and Plane icon buttons beside the title are hard to discover.
  A text segmented control, "Plan | Stays | Travel", is clearer and fits at
  375px.

### 5. Day page navigation — ✅ done 2026-10-03

**Decision:** all three. Show "Day N of M", put prev/next at the bottom too and add swipe, and drop the "← Trip" link. (Phase 24)

- There's no "Day 2 of 5" context on the day page.
- You can only change days with the single prev/next button at the top.
  Add swipe left/right between days, or prev/next at the bottom too.
- The "← Trip" link duplicates the Timeline tab in the bottom nav. Keep one,
  or make the tab return to the trip overview when you're already on it.

### 6. Map

**Decision:** no "Locate me" for now. Directions hand off to the phone's maps app, which is more trustworthy (and works offline). The map stays a tab. The odd screenshots are a quirk of the headless browser; the info windows look fine on a real device.

- Add a **"Locate me"** blue dot: "how far am I from the hotel?" is a
  constant on-trip question.
- ~~The info window can open underneath the search bar.~~ **Fixed
  2026-10-03 (Phase 16):** a focused marker sits below center, so its window
  clears the controls.
- In the headless screenshots, the emoji glyphs on the pins render as empty
  boxes, and one info window's photo area looks blank. That may only be a
  font issue in the test browser, but check it on the phone. Real SVG icons
  would remove the risk.

### 7. Trips list — ✅ done 2026-10-03

**Decision:** groups in this order: Active (hidden when empty), Upcoming, then Past at the bottom (collapsed). Delete goes in a "⋯" menu. The app lands on the next trip, and the trips list moves behind a nav drawer. (Phase 20)

- There's no upcoming / active / past grouping. Put the active trip first,
  then upcoming, with past trips collapsed.
- The trash icon sits right next to the main tap target. There's a confirm
  dialog, but it's still easy to hit by mistake. Move delete into an
  overflow menu.

### 8. Small tap targets and noise — ✅ done 2026-10-03

**Decision:** both. Drop the header line and enlarge the links. (Phase 20)

- "Open map", and other `text-xs` links, are below a comfortable 44px tap
  height.
- The header line "Times are local (Zurich unless noted)" takes two lines at
  375px and says little. The zone already appears wherever it differs.

### 9. Phone chrome (addressed by Phase 18)

- Safe-area padding for the notch and home indicator, once it's installed as
  a PWA.

## Experiments

- **Hero fade in the stays/travel quick look** (2026-10-03, Julian's idea:
  thumbnails were hard to see). A stay's photo fills the top of the dialog
  and fades into the card behind the title; the details sit on solid card.
  Legs use their destination's photo (else the departure point's).
  **2026-10-05:** the expanded entries (day page, Today) use the same hero
  fade, from one component (`HeroFade`) and one rule (`describeEntry().hero`),
  so a stay, leg or activity looks the same in the dialog and in its row. The
  small thumbnails are gone, and airport/station photos are used as heroes
  too. It's still a deliberate departure from design_doc.md's "no gradients",
  so it's easy to revert (drop the `HeroFade` uses).

## Next follow-up

- A **text-size preference**: the text is small. It should also scale the
  timeline rails and dots.
