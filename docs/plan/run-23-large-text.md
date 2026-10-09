# Run stage 23 — large text

Follow-up to Phase 86 (text size). Julian (2026-10-07): at Large and
Larger, a day page's timeline rows squeeze the title and description into a
narrow column, so each row grows tall and is mostly empty space. Move the
title and description under the rest of the row.

**Status: complete.** Phase 87 built (2026-10-08).

## Where we are

- One component draws every entry row: `TimelineEntry.jsx`, used by the
  day page (`DayDetailPage.jsx`) and Today (`TodayPage.jsx`). Fixing it
  fixes both.
- The row is a single flex line: time column (fixed `4.5rem`) · icon
  (`1.5rem`) · title / subtitle / warning (`flex-1`) · chevron, or the
  editor's RowMenu. The fixed parts are all in rem, so they grow with the
  text size, and the text column takes what's left over.
- Rough sums at 375 px, Larger (1rem = 20 px): the card is about 315 px
  wide; padding, time column, icon, the gaps and the chevron take about
  210 px, which leaves the title around 100 px, about 8–10 characters per
  line. With the RowMenu (editors) it's narrower still. The time column
  stacks (start, zone, end, end zone), so it's tall too, and the row ends
  up tall in two narrow columns with empty space beside them.
- Phase 86 fixed the same kind of problem on day rows (`RowHead` in
  `DayRow.jsx`): the right-hand words drop under the date when they'd be
  narrower than 4.5rem.

## Design

At Large and Larger (the text size setting, Q-T1), an entry row becomes
two parts:

```
┌──────────────────────────────────────────┐
│ [icon] 9:00 AM – 11:30 AM · JST       ⋮  │  ← top line: icon, time, menu/chevron
│ Fushimi Inari shrine, early before the   │  ← title, full card width
│ crowds                                   │
│ Take the JR Nara line to Inari           │  ← subtitle
│ ⚠ Overlaps with the train to Osaka       │  ← warning
└──────────────────────────────────────────┘
```

- **Top line:** the icon, then the time on one line (start – end, the +1
  marker, and the zone when it differs from the trip's), then the
  chevron or RowMenu on the right. If the times don't fit on one line
  (two zones, at Larger), the end part wraps under the start, still in
  the top line.
- **Below:** title, subtitle and warning, flush with the card's padding,
  across the full width (Q-T2). On editors' rows the ⋯ menu stays outside
  the link, so the text runs up to it, not under it.
- **No time** ("—" at Normal): the title sits beside the icon, with no
  dash (Q-T3).
- The rail dot stays where it is (`top-4`), so it lines up with the top
  line, the same as now.
- The link still covers the whole row (top line and text), and the menu
  stays outside it, as now.
- Normal text size keeps today's single-line layout, unchanged.

## Phases

- **Phase 87 — entry rows stack at large text.**
  - **Scope:** `TimelineEntry.jsx` reads the text size (`useTextSize`)
    and, at Large / Larger, renders the two-part layout above. The time
    column gets an inline (one-line) form for the top line. The day page
    and Today pick it up with no other change. ui/README.md and the run
    stage note updated.
  - **Tests:**
    - At Normal, the row is unchanged (time column, icon, text in one
      line; existing tests stay green).
    - At Large / Larger: the title and subtitle render after the top line
      (icon, time, menu/chevron), and the time reads on one line
      ("9:00 AM – 11:30 AM").
    - An untimed entry at Large puts the title beside the icon.
    - The editor's RowMenu is still there and still outside the link;
      the link still goes to the entry's page.
    - Switching text size in the drawer re-renders open rows without a
      reload.
  - **E2E:** at 375 px, Larger, on a day page as an editor and on Today:
    the text below the top line is over 70% of the card's width (it was
    about a third). Screenshots of both, dark and light, for a human look.

## Built

- **Phase 87 ✅ (2026-10-08).** `TimelineEntry.jsx` reads `useTextSize()`;
  at Large / Larger a timed row is a top line (icon, `TimeLine`: the time
  on one line, end half wrapping as a whole, chevron) over the title,
  subtitle and warning. Untimed rows: text beside the icon, no dash.
  Normal is unchanged. Unit: `TimelineEntry.test.jsx` (9). E2E:
  `large-text.spec.js` (Bern day 2 as an editor, Athens Today; dark and
  light; screenshots `23a-larger-day-*`, `23b-larger-today-*`, looked at).
  Editors' rows measure ~73% (the ⋯ menu), the rest ~90%.

## Open questions

- **Q-T1. What switches the layout?**
  - (a) *Recommended:* the text size setting. Large and Larger stack,
    Normal doesn't. Simple, predictable, and testable in jsdom.
  - (b) The card's width in rem (a CSS container query): it stacks
    whenever the text column would be too narrow, so it also covers small
    phones and browser zoom at Normal. Needs the Tailwind container
    queries plugin, and only the e2e can test it.
  - **Answer:** (a) (Julian, 2026-10-08). Large and Larger.
- **Q-T2. Below the top line, where does the title start?**
  - (a) *Recommended:* flush with the card's left padding, using the full
    width.
  - (b) Indented to line up with the time (after the icon), so the icon
    sits alone in a left gutter, at the cost of about 2rem of width.
  - **Answer:** (a) (Julian, 2026-10-08).
- **Q-T3. Entries with no time?**
  - (a) *Recommended:* the title moves up beside the icon (no top line
    holding only a dash).
  - (b) Keep the same shape as timed rows, with "—" in the top line.
  - **Answer:** (a) (Julian, 2026-10-08).
- **Q-T4. Anywhere else to cover in this branch?** Other rows that
  squeeze at Larger (the stays/coverage view, packing, the trips list)
  could be checked in the same e2e tour and fixed in later phases of this
  run. Or keep this run to the timeline entry only.
  - **Answer:** the timeline entry only (Julian, 2026-10-08).
