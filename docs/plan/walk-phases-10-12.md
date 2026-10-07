# Walk — Phases 10–12: day rows with cities, day pages, coverage views

## Phase 10 — Walk: collapsed day rows with cities ✅

The date strip didn't earn its space, especially with days collapsed. The
timeline becomes the whole page.

**Scope**
- Remove the sticky date strip (`DateJumper`) and the scroll observer.
- Every day starts collapsed, and every date gets the same row (no slim "No
  plans" variant). The row is one button:
  - the date on the left, and the day's cities on the right ("Bern → Wengen");
  - underneath, the title in bold followed by the summary
    ("**Arrive in Bern** — Land in Zürich, …"), or whichever of the two exists.
- Tapping the row opens the day: entries (each still expandable), Add, and
  Edit day. Any number of days can be open at once.
- `?day=YYYY-MM-DD` opens that day and scrolls to it. Tapping doesn't rewrite
  the URL.
- **Cities.** They come from the day's entries in timeline order:
  - travel gives its from and to places, and an overnight arrival gives its to
    place;
  - stay markers give the stay's place;
  - activities give their place.

  Repeats in a row are merged. A place whose city can't be judged adds nothing,
  and a day with none shows nothing on the right.
- **Where a place's city comes from.**
  - A new optional `city` on `LocationDoc`. It isn't editable: it's set from
    Google's address components (`locality`, else `postal_town`) when a place is
    picked, and kept when the place is renamed.
  - When `city` is missing (imports, typed names), a cautious guess is taken
    from `address`: the second-to-last comma part with postal-code tokens
    removed, skipping a US-style state code. With no address, there's no city.

**Tests**
- API: `city` round-trips through import and edits, and the schema includes it.
- UI unit: `cityOf` (stored city, address guesses, nothing to judge) and
  `dayCities` (order, merging, overnight arrival).
- Page:
  - days start collapsed, and the row shows the date, cities, title and summary;
  - tapping opens a day;
  - `?day=` opens and scrolls to that day, and an unknown date is ignored.
- The editing tests open the day before editing.
- A live browser check at phone width.

## Phase 11 — Walk: day detail pages ✅

Editing controls and a day's entries cluttered the trip overview once days
could hold a lot. A day gets its own page.

**Scope**
- `DayRow` (was `DayCard`): the trip page's row is now a plain link to
  `/trips/:id/days/:date` — date, cities, title, summary, nothing else.
- `DayDetailPage`: that date's entries, add/edit/delete for activities, stays
  and travel, and the day's own title/summary. Prev/next day links (styled as
  real buttons, not text links, so they don't read as the "back to trip" nav
  above them); a fallback for a date outside the trip.
- `RailDot`: the dot-and-line rail factored out of the old `DayCard`, shared
  between the trip page's day rows and the day page's entry rows — one dot
  per entry, by time, instead of one per date.
- The `?day=` deep link on the trip page is dropped; a day's own URL replaces
  it.

**Tests**: `TripTimelinePage.test.jsx` trimmed to overview concerns; new
`DayDetailPage.test.jsx` for the day page's own view/navigation; editing
tests (`TimelineEditing.test.jsx`, `BookingEditing.test.jsx`) updated to
render the day page directly. A live Playwright pass.

## Phase 12 — Walk: stays/travel coverage views ✅

"Just a visual way to see what nights we have a hotel for."

**Scope**
- `coverageView.js`: `stayCoverage(trip)` — a stay covers the *night* of date
  D when its check-in date <= D < its check-out date, first stay claiming a
  date wins. `travelCoverage(trip)` — a date is covered by a leg's depart
  date, plus its arrival date too when it lands later; same-day legs (normal
  for travel, e.g. a connection) join into one label and carry every record,
  keeping the first leg's color.
- A fixed 8-color categorical palette (`--series-1`..`8` in `index.css`,
  `bg-series-1`..`8` in Tailwind) — the dataviz skill's dark-surface
  reference palette, converted to this app's HSL token convention and
  re-validated with its script. Color is assigned by position, never by
  rank; the name is always shown as text too, since this app has no light
  theme to also validate.
- `RailDot` no longer takes a fixed `tone` enum; it takes any `bg-*` class,
  so day rows can show a categorical color instead of primary/warning/muted.
- Two icon buttons (House, Plane) next to the trip title switch the trip
  overview between plan/stays/travel — exactly one at a time, the selected
  one filled (not just a subtler `secondary` shade — needed to read clearly
  as "pressed" at icon-button size).
- **Adding/editing moved off the day page, into these views.** Selecting a
  date opens a read-only `BookingDetailsDialog` quick look when a stay/leg
  already covers it (name, dates, location with a mini-map, confirmation,
  notes, an "Edit" button) — never straight to the edit form. An uncovered
  date opens the add form, prefilled for that date. A date with more than
  one travel leg falls back to the day page, the only place that lists both.
  The day page's Add button is now just "Add activity"; existing stay/travel
  markers on a day are still edited/deleted from there.
- `runEdit.js` factors the thunk-dispatch-to-`{ok}`/`{errors}` helper shared
  by `TripTimelinePage` and `DayDetailPage`.

**Tests**: `coverageView.test.js`; `TripTimelinePage.test.jsx` covers the
toggle; `CoverageEditing.test.jsx` (new) covers adding/opening from the
coverage views, including the two-legs-same-date fallback. A live Playwright
pass, including the stays/travel screenshots.
