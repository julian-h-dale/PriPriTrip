# Run stage 6 — places in the seed data, map filters and pins, swiping days

Asked 2026-10-04 (Julian):
- Put the Google place data (`placeId`, `imgRef`) into `example-trip.json`
  and the seed data, using the existing backfill.
- **Map filters:** Journal shouldn't be on by default, and when it's on the
  map should show **only** memories.
- **Map pins:** clean, simple outline icons like the app's buttons, not
  emoji.
- **Days:** the previous/next links are duplicated at the top and bottom of
  the page. Replace them with a real swipe between days.

**Decisions** (answered 2026-10-04):
- Journal and Stays are **either-or** ("only memories" or "only stays").
  The Calendar filter still narrows either one to a single day.
- **Embla swipe only.** No sticky header; the prev/next links go.
- **Use an up-to-date Embla:** `embla-carousel-react` **8.6.0**, the latest
  stable release (2025-04). v9 has been in release candidates since
  2026-01 (rc03 on 2026-08-21) and isn't released, so not that. It supports
  React 18.

### Design

**1. Places in the trip files.** `make backfill-photos` runs against the dev
database, then each location's `placeId` and `imgRef` are copied back into
`example-trip.json`, `api/app/sample_data/sample_trip.json` and
`api/app/sample_data/demo_trip.py`. The JSON files are matched by document
position (with a name check), because one trip has the same name for two
places (TPE Terminal 2 with two place ids). The demo trip is matched by
name. The seed still plants only the sample and demo trips.

**2. Map filters** (`mapFilters.js`, `MapControls.jsx`, `MapPage.jsx`):
- One "what" filter: `null` (everything except memories), `"stays"` or
  `"memories"`. The default is `null`, so memories are hidden by default.
- Tapping Journal or the house toggles that filter; turning one on turns
  the other off.
- `filterMarkers(markers, { only, date })`. The date applies on top, as now
  (a stay matches any night it covers, and a memory matches the day it was
  made).

**3. Outline pins.** The pin stays a coloured `PinElement` (same colours per
kind). Its glyph becomes the same Lucide outline icon as the search rows
(`iconFor`: BedDouble, the travel mode icons, MapPin, NotebookPen), drawn in
white. It's rendered once per icon to an SVG data URL
(`renderToStaticMarkup`) and passed as `glyphSrc`. `glyphFor` and the emoji
go. If `glyphSrc` doesn't take an SVG data URL on the live map, we fall back
to passing the SVG element as `glyph`.

**4. Swiping between days** (`DayDetailPage.jsx`):
- An Embla carousel with one slide per day of the trip. Only the current day
  and its two neighbours render their timeline; the others are empty
  slides, so a 16-day trip doesn't render 16 timelines.
- The slide follows the finger, and releasing past halfway (or flicking)
  settles on the next day. Embla only takes horizontal drags, so vertical
  page scrolling is untouched.
- **The URL stays the source of truth.** Settling on a slide replaces the
  URL (`/trips/:id/days/:date`, `replace` so Back isn't a list of every day
  swiped). A URL change from elsewhere (the timeline, the Today tab, search)
  jumps the carousel with no animation.
- **Height:** each slide is only as tall as its own day (`align-items:
  flex-start` on the container), so a short day doesn't leave a long empty
  page. After settling, the page scrolls to the top.
- **Dialogs:** the edit dialogs are portals, but React still bubbles their
  events to the carousel, so Embla's `watchDrag` ignores drags that start
  outside the viewport. The current `useDaySwipe` guard does the same job
  today.
- Removed: `AdjacentDayLink` (top and bottom) and `useDaySwipe`.
- At the trip's ends there's nothing to swipe to: Embla's edge resistance
  shows that, with no loop.
- **Desktop:** Embla also drags with a mouse. The arrow keys move between
  days (a listener on the page, ignored while typing in a field or a dialog
  is open), since the visible links are gone.

### Phases

- **Phase 37 — places in the trip files and seed data.** ✅ (2026-10-04)
  - The backfill matched all 35 locations of the sample and demo trips (the
    Okinawa trip already had all of them).
  - The three documents still validate. Seeded locations have a `placeId`
    and `imgRef`.
  - **Julian:** spot-check the name-matched places that could be wrong:
    "Bern", "Wengen", "Syntagma" and "Athens Airport" are city/area names,
    matched by Places text search.
  - **Tests:** the API tests pass unchanged. Two UI tests had assumed the
    sample had no place ids (`buildMapMarkers`, and the day page's map
    link, which now carries `query_place_id`); they now expect the real
    ones. Nothing fetches the `imgRef` URLs in a test.
- **Phase 38 — map filters and outline pins (UI).** ✅ (2026-10-04)
  - **Built as planned, plus:**
    - The pin icons come from the vanilla **`lucide`** package (`^0.469.0`,
      the same version as lucide-react). lucide-react doesn't export its
      icon shapes, and `react-dom/server` would be a large extra download
      for a few icons. `glyphSrc` with an SVG data URL works on the live
      map (checked in Chromium at 375px).
    - The picked-Google-place pin's "+" is the outline `Plus` icon too.
    - The buttons are labelled "Show only memories" and "Show only stays".
  - **Tests:** `mapFilters.test.js`: the default hides memories; `"memories"`
    shows only memories; `"stays"` shows only stays; the date combines with
    each. `MapControls`: turning Journal on turns the house off and the
    reverse, and Journal starts unpressed. `mapStyle`: every kind and travel
    mode has an icon.
  - **Julian, at 375px:** the pins read clearly on the map.
- **Phase 39 — swipe between days (UI).** ✅ (2026-10-04)
  - **Built as planned, plus:**
    - ~~`embla-carousel-auto-height`~~ **Removed (fix, 2026-10-04):** it
      fixed the carousel's height on arrival, so expanding entries clipped
      the day and the page stopped scrolling (Julian spotted it). Now the
      carousel takes its natural height, and the off-screen neighbours are
      capped at one screen (`max-h-dvh`), so a long day next door can't add
      empty space. The swipe e2e opens every entry and checks the page
      scrolls to "Edit day" (screenshot `03c`).
    - The page scrolls inside `BottomNavLayout`, not the window, so its
      scroll container is marked `data-scroll-root`. A swipe scrolls that
      to the top once the new day settles.
    - Neighbouring days are `aria-hidden` and `inert`, so only the day in
      view can be read out or focused.
    - The edit dialogs are portals, so drags inside them never reach Embla;
      no extra guard is needed.
    - Tests use a small fake Embla (`src/test/fakeEmbla.js`, mocked for
      every test in `setup.js`); jsdom has no layout for the real one.
    - The Playwright test drags with the mouse, swipes with real touch
      events, checks a vertical drag doesn't change the day, and checks Back
      goes to the timeline (screenshots `03a`, `03b`).
  - **Tests:** with Embla mocked in jsdom (it measures layout, which jsdom
    doesn't have): the URL picks the slide; settling on a slide replaces the
    URL; only the current day and its neighbours render a timeline; the
    arrow keys change the day and are ignored in an input or a dialog; no
    prev/next links remain. A Playwright check drags the page sideways at
    375px and lands on the next day's URL.
  - **Julian, on a real phone:** swiping feels right, vertical scrolling
    never changes day, and dragging inside an edit dialog doesn't either.

### Open questions (Run stage 6)

None outstanding. The Embla version and the arrow keys are decided above;
say if either should change.
