# Run stage 22 — light mode

From [the 2026-10-07 review](../ui-review-2026-10-07.md) §6: the app is dark
only, with mid-grey secondary text, which is the hardest thing to read
outdoors in bright sun. Julian (2026-10-07): plan a light mode, switched on
or off from the drawer on the **All trips** screen.

**Status: planned.** All questions answered (2026-10-07).

## Where we are

- `index.html` sets `class="dark"` on `<html>`, and Tailwind uses
  `darkMode: "class"`, but the colour tokens in `src/index.css` are defined
  once, on `:root`, with dark values. There's no light set to switch to.
- Nearly all colour goes through semantic tokens (`bg-background`,
  `text-muted-foreground`, `border-border`, `primary`, `warning`,
  `--series-1…8` for the coverage views). A handful of files use raw
  colours: the dialog and drawer backdrops (`bg-black/70`), the photo viewer
  (black on purpose), the map's pin glyphs and info windows, and the
  memory dialog.
- The map is Google's own light style already (a Map ID with no dark
  styling), so it doesn't change.
- `<meta name="theme-color">` (the phone's status bar) is fixed at the dark
  background, `#12151c`.
- [design_doc.md](../../design_doc.md) says "Dark mode is the default and
  only theme"; it'll say dark is the default, with a light theme kept in
  step.
- The drawer on the trips screen already has screen-specific items
  (Invite someone, for admins).

## Design

### The switch

- **"Light mode"** in the drawer, on the All trips screen only, for
  everyone, as a switch (on / off).
- **Dark is the default.** The choice is remembered on this phone
  (`localStorage`) (Q-L1), and applied before the first paint (a few lines
  in `index.html`), so the app never flashes dark first.

### The light theme

- A second token set: `:root` keeps the dark values under `.dark`, and the
  light values sit under `.light` (or plain `:root`). Switching moves one
  class on `<html>`.
- Light values are chosen for **sunlight**: near-white background, near-
  black text, and secondary text darker than a typical light theme's (at
  least 7:1 against the background, AAA, not the usual 4.5:1). Borders
  visible without squinting.
- The `--series-*` palette for the coverage views gets light-surface values
  checked the same way (colour-blind-safe neighbours, enough contrast on
  white).
- Status colours (`warning` for the offline bar, `primary` blue, the
  orange of bookings on day pages) get light variants with the same
  meaning.
- Raw colours: backdrops stay dark (they dim what's behind either way);
  the photo viewer stays black; the map's info windows already sit on
  Google's white.
- `theme-color` follows the theme, so the status bar matches.

### Text size (Q-L2)

- **Text size** (from the backlog) sits next to the switch on the All trips
  drawer: Normal / Large / Larger, remembered per phone like the theme.
- It scales the type (the root font size, so everything in `rem` follows)
  and the timeline's rails and dots with it, so the rail lines up with
  bigger dates.

## Phases

- **Phase 85 — the light theme and its switch.**
  - **Scope:** the light token set and the class switch; the drawer switch
    on All trips; remembered and applied before first paint;
    `theme-color`; design_doc.md updated.
  - **Tests:**
    - The switch shows on All trips only; it toggles the class and is
      remembered across a reload.
    - Contrast: a unit test computes the contrast of the key token pairs
      (foreground, muted text, primary, warning on background) in both
      themes against their targets.
  - **E2E:** screenshots of every page in light at 375 px (the same tour as
    the review), looked at by a human for anything still dark-on-light or
    illegible.
- **Phase 86 — text size.**
  - **Scope:** Normal / Large / Larger on the All trips drawer, remembered
    per phone and applied before first paint; the timeline's rails and
    dots scale with it.
  - **Tests:** the choice sets the root size and is remembered; the
    timeline's dot stays centred on its date at each size.
  - **E2E:** the timeline, a day page and Today at Larger, at 375 px.

## Built

- **Phase 85 ✅ (2026-10-07).** `:root.light` in `index.css` (every dark token,
  darkened status and coverage colors); `shared/theme.js` (class on
  `<html>`, `theme-color`, `localStorage`); the pre-paint script in
  `index.html`; the "Light mode" switch in the All trips drawer (the
  memory dialog's switch, now `ui/switch.jsx`). `src/test/contrast.test.js`
  computes the key pairs in both themes (22 checks). design_doc.md
  updated. E2E `light-mode.spec.js`: on from the drawer, applied on reload
  before the app runs, and screenshots of every page (looked at: trips,
  Today, timeline, stays view, day, entry, dialog, drawer, offline bar).

## Open questions

- **Q-L1. Remembered per phone or per account?**
  - (a) *Recommended:* per phone. It's about where you're reading (a
    bright phone screen outdoors vs a laptop indoors), and it works before
    sign-in and offline.
  - (b) Per account, so it follows you to another device.
  - **Answer:** (a) (Julian, 2026-10-07). Per phone.
- **Q-L2. Bring the backlog's text-size setting in with it?**
  - (a) *Recommended:* yes, as Phase 86: both are "can I read this out
    there", and they share the same drawer spot and the same screenshots.
  - (b) No, light mode alone; text size stays in the backlog.
  - **Answer:** (a) (Julian, 2026-10-07). Yes, Phase 86.
