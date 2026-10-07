# Run stage 16 — points of interest, one Filter button, a list of what's on the map

Asked 2026-10-06 (Julian), on branch `points-of-interest` (off `main` after
PR #15). Some plans are "explore the streets" or "the market", with shops
and spots worth finding along the way. Mark those on the map as **points of
interest**: they show only on the map, with their own filter. Also: fold
the map's filter toggles into one Filter button, and add a **List** button
that lists what's on the map and jumps to any of it.

## Where we are

- **The map** (`features/map/MapPage.jsx`) shows one pin per located stay,
  travel end and activity (`buildMapMarkers`), plus memories with a place
  (`memoryMarkers`).
- **Adding from the map:** a Google search shows a temporary pin, and its
  info window offers Add as activity / stay / travel (`placeActions`, then
  the usual form).
- **The top row** (`MapControls.jsx`): the search box, then **Journal**
  (memories only) and **Stays** (stays only), which are either-or
  (`only`), then **Calendar** (one day) and **Locate**. At 375 px that's the
  box plus four 40 px buttons.
- **Jumping to a marker:** `selectMarker` zooms in, centres the pin
  (nudged clear of the controls) and opens its info window. The search
  box's trip rows already use it.
- **Bottom left** is Google's logo and attribution, which have to stay
  visible (Google's terms).
- **Stays, legs and activities** are rows on the trip (`models.py`, with a
  version for conflicts and soft delete). They come back in `GET /trips/:id`,
  so the phone's saved copy has them offline, and they're part of the trip
  document (export/import).

## Design (assuming the recommended answers)

### Points of interest

**What one is** (Q-P1, Q-P2): a place on the trip that isn't booked or
scheduled.
- **Fields:** a name, a place (from Google, with coordinates, address and
  photo, like an activity's), a **category**, and optional notes.
- **Categories:** Shop, Market, Food & drink, Sight, Other. Each has its own
  icon, which shows on its pin and in the list.
- **No day and no time:** it doesn't appear in the timeline, Today, a day
  page or trip search. It's on the map only.

**Stored with the trip** (Q-P3): a new `points_of_interest` table, shaped like stays
(owned through the trip, versioned, soft-deleted).
- It comes back in `GET /trips/:id`, so it works offline from the phone's
  saved copy.
- It's in the trip document as `pointsOfInterest[]` (optional), so export and import
  keep it.
- The owner and editors add, edit and delete them. Viewers see them.
- A conflicting edit (409) behaves as it does for a stay.

**Adding one:** search for it on the map. The Google result's info window
gets a new action, **Point of interest**, shown first for shops, markets,
cafés and sights, and under "More…" otherwise. It opens a small form:
name (prefilled), category (guessed from Google's types), notes.
- Dropping a pin anywhere by long-pressing the map, for a spot Google
  doesn't know, is not in this stage (Q-P4).

**On the map:**
- **Pin:** its own colour, with the category's icon.
- **Info window:** photo, name, address, category, notes, Directions; plus
  Edit and Delete for editors, greyed out offline.
- **Shown by default** with the trip's other places (Q-P5).
- **The map's search box** finds them, under "On this trip".

### One Filter button (Q-F1)

Journal and Stays fold into one **Filter** button (a funnel icon). It opens
a small menu of what to show, one choice at a time:
- **Everything** (the default): the trip's places and points of interest.
- **Stays**
- **Points of interest**
- **Journal** (memories)

While a filter other than Everything is on, the button is filled blue and
shows that filter's icon, so it's clear the map is filtered. Calendar and
Locate stay as they are. The top row becomes the search box, Filter,
Calendar and Locate, one button fewer than now.

### The List button (Q-L1, Q-L2)

- **The button:** a round button with a list icon, at the bottom left of
  the map, just above Google's logo.
- **Tapping it** opens a dialog over the map listing the markers currently
  shown, after the filters and the day. Each row has the kind's icon (a bed,
  the travel mode, a pin, the point of interest's category, a notebook) with
  the name and address underneath.
- **Order:**
  - Grouped under headings: Stays, Activities, Travel, Points of interest,
    Journal.
  - Within a group, in trip order (day, then time).
  - Points of interest are A–Z, since they have no day.
- **Choosing a row** closes the dialog, then zooms to the pin and opens its
  info window (`selectMarker`).
- **Nothing to add from here:** it's for getting around the map.
- **Not in the list:** the search result's temporary pin and the blue
  "you are here" dot.
- **Nothing shown** (e.g. a day with no places): the list says so.

## Phases

- **Phase 68 — points of interest on the server.**
  - **Scope:**
    - `PointOfInterest` model and migration 0013.
    - Schemas (camelCase).
    - `POST/PUT/DELETE /trips/:id/points-of-interest`, with `If-Match`
      versions and a 409 like stays.
    - `pointsOfInterest` in `TripRead`.
    - `pointsOfInterest[]` in the trip document (import and export) and the
      JSON Schema.
    - Viewers refused (403), foreign trips 404.
  - **Tests:**
    - Create, edit and delete.
    - A version conflict gives 409.
    - Viewer refused; foreign trip 404.
    - Soft delete hides it.
    - Export → import round trip.
    - `make migrate` on a copy of the dev database.
- **Phase 69 — points of interest on the map.**
  - **Scope:**
    - Markers from `trip.pointsOfInterest` (colour, category icon).
    - "Point of interest" as an add action on a Google result, guessed
      from its types.
    - `PointOfInterestForm` (name, category, notes).
    - The info window with Edit and Delete.
    - Found by the map's search box.
  - **Tests:**
    - Adding from a search result saves and the pin appears.
    - Category guessed from types.
    - Edit and delete from the info window.
    - Viewers see no actions; offline greys them.
    - 409 shows the conflict notice.
    - Not in the timeline, Today or trip search.
- **Phase 70 — the Filter button.**
  - **Scope:** the Filter menu replaces Journal and Stays; `only` gains
    `"pois"`; the filled state with the filter's icon; the map refits to
    what's left (as now).
  - **Tests:**
    - Each choice shows only its kind; Everything is the default and
      includes points of interest.
    - The button shows when a filter is on.
    - Works with a day picked.
  - **E2E:** the top row and the open menu at 375 px.
- **Phase 71 — the List button.**
  - **Scope:** the button above Google's logo; the dialog of shown markers
    grouped by kind, with icons, names and addresses; choosing one jumps
    to it.
  - **Tests:**
    - Lists exactly what the filters show.
    - Grouping and order.
    - Choosing a row closes the dialog, then zooms and opens the info
      window.
    - The empty state.
    - The search pin and "you are here" aren't listed.
  - **E2E:** the button's position (not covering Google's logo) and the open
    list at 375 px, then a tap through to a pin.

## Built

### Phase 68 (2026-10-06): points of interest on the server

`make verify` green (260 API + 433 UI tests;
`tests/test_points_of_interest.py`). The migration (0013) ran on a copy of
the dev database.
- **Model:** `PointOfInterest` (`points_of_interest` table): name, category (`shop`, `market`,
  `food`, `sight`, `other`; default `other`), location (required, with
  coordinates: rule 6), notes. Versioned and soft-deleted like a stay.
- **API:** `POST /trips/:id/points-of-interest`, `PUT` and `DELETE
  /trips/:id/points-of-interest/:id` with `If-Match`, each returning the
  trip. `GET /trips/:id` always has `pointsOfInterest` (an empty list when
  there are none).
- **The trip document:** `pointsOfInterest[]`, optional. A trip with none
  exports with no `pointsOfInterest` key (a serializer on `TripDocument`),
  so older documents and exports are unchanged. The JSON Schema is
  regenerated.
- **Naming (Julian, 2026-10-06):** "point of interest" everywhere, never
  "place", which already means a Google result or an entry's location.
  `PointOfInterest`, `pointsOfInterest`, `/points-of-interest`; `poi` for
  short in code (the map's marker kind).
- **Deploy:** run `make migrate` (start.sh does it on Fly).

## Open questions (Run stage 16)

- **Q-P1. Categories for points of interest?** Recommendation: **yes, a
  small fixed set:** Shop, Market, Food & drink, Sight, Other. Each gets
  its own icon on the pin and in the list. Different set, or none (one icon
  for all)?
  - **Answer:** as recommended (2026-10-06).
- **Q-P2. No day at all?** Recommendation: **no day.** A point of interest
  belongs to the trip, not to a date. With a day picked on the map, points
  of interest are hidden like other things not on that day.
  - The alternative is an optional day ("near Thursday's market walk"), so
    they'd show when that day is picked.
  - **Answer:** as recommended (2026-10-06).
- **Q-P3. Shared with everyone on the trip** (editors add and edit, viewers
  see), and part of the trip's export? Recommendation: **yes.** Personal,
  private ones like packing lists are the alternative.
  - **Answer:** as recommended (2026-10-06).
- **Q-P4. Adding:** from a Google search only for now? Recommendation:
  **yes.** Long-press anywhere on the map to drop a pin, for a street corner
  Google doesn't know, could follow later.
  - **Answer:** as recommended (2026-10-06).
- **Q-P5. Shown by default,** or only when the Filter asks for them (like
  memories)? Recommendation: **shown by default:** they're places you mean
  to go, and the Filter can show them alone.
  - **Answer:** as recommended (2026-10-06).
- **Q-F1. The Filter menu as above** (Everything, Stays, Points of
  interest, Journal; one at a time)? Or checkboxes, to show any mix, e.g.
  stays and points of interest together? Recommendation: **one at a time**,
  as the toggles work now, simpler to read.
  - **Answer:** as recommended (2026-10-06).
- **Q-L1. The list's order:** grouped by kind (as above), or one list in
  trip order? Recommendation: **grouped by kind.**
  - **Answer:** as recommended (2026-10-06).
- **Q-L2. After choosing a row,** close the list and show the pin with its
  info window? Recommendation: **yes.** The List button reopens it.
  - **Answer:** as recommended (2026-10-06).
