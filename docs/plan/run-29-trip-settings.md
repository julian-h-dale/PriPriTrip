# Run stage 29 — trip settings; the timeline keeps its place

Julian (2026-10-12): a "Trip settings" page, opened from the all-trips
screen as another option next to Delete. On it: edit the trip's name (saved
on the server) and set the radius for nearby points of interest (kept on
this phone). Also: recommend other settings for the page.

Julian (2026-10-12, second pass):
- **Dropped:** "last updated" (a lot of work for little value), and
  editing dates or the time zone (the app works out wall-clock time from
  each place, which stays as it is).
- **Taken:** miles or km; people on the trip; Export and Delete / Leave on
  the page; what opens first; a cover for the card.
- **Added:** going from the timeline to the map and back loses your place.
  From the Stays list, for example, you come back to the Plan, at the top.
  The timeline should remember where you were.

Julian (2026-10-12, third pass): "I will take all of your suggestions"
(Q1–9 below).

**Status: answered (every question took its suggestion); building.** Branch
`trip-settings` (off `main` at `3bf166b`).

## Where we are

- **The ⋯ menu on a trip card** (`TripCard` in `TripsPage.jsx`) has one
  item: Delete trip, or Leave trip on a trip someone shared with you.
  `RowMenu` takes a list.
- **Nothing edits the trip itself.** The name is set at import, and
  `routers/trips.py` has no `PATCH /trips/{id}`.
- **The nearby radius** is `NEARBY_METRES` (half a mile) in
  `pointsOfInterest/nearby.js`. `nearbyPointsOfInterest` already takes a
  `radius`. `milesLabel` is the only distance shown in the app. Weather
  shows °F, mph and inches, with °C alongside, from `weather/units.js`.
- **Per-phone choices have a pattern.** `timeline/planChoice.js` stores
  `{ [tripId]: … }` in `localStorage`, with a fallback for when storage
  throws and `useSyncExternalStore` so screens update at once. `theme.js`
  and `textSize.js` do the same for whole-phone choices.
- **Share** is the owner's dialog in the drawer (`ShareTripDialog`: invite
  by email, roles, Remove). `GET /trips/{id}/members` is owner-only.
- **Export exists only as an endpoint.** `GET /trips/{id}/export` was
  built in Run 8 with "no UI in this stage". Nothing in the app calls it.
- **What opens first** is `tripHomePath` (`shared/utils/tripDates.js`):
  Today, except the timeline for viewers and for past trips.
- **Photos** belong to journal memories and are served by an unguessable
  URL with no login (`/photos/{id}/{variant}`). Viewers see only public
  memories.
- **Why the timeline forgets.** `TripTimelinePage` holds Plan / Stays /
  Travel in `useState("plan")`. The map is another route, so the timeline
  unmounts, and both the view and the scroll position are lost. The journal
  already solves the same problem for Back from a memory: `savedScroll`, a
  map in memory of trip → `scrollTop` on `[data-scroll-root]`, restored in a
  layout effect.

## Design

### Who sees the page

Owners and editors (Q2: not viewers). The ⋯ menu gets **Trip settings**
(gear icon) above Delete / Leave, for those two roles only. The route
`/trips/:tripId/settings` sends a viewer back to the trip.

### The page, top to bottom

1. **Cover.** The emoji or photo the card shows (see below).
2. **Name.** A text field with Save, enabled once the name changes. Saving
   shows the "Saved" toast. It can't be blank, has a 120-character limit,
   and is trimmed. Disabled offline or in "saved copies only", with the
   usual "You’re offline" hint.
3. **On this phone.** Grouped under one heading with a note, "Only on this
   phone", so it's clear these don't change the trip for anyone else. They
   work offline and apply at once, with no Save.
   - **Opens on:** Today · Timeline · Map.
   - **Distances:** Miles · Kilometres. It applies to the whole phone,
     every trip (Q3).
   - **Nearby points of interest:** "Show places within…" ¼ · ½ · 1 · 2
     mi, or 0.5 · 1 · 2 · 3 km when Distances is km. The default is ½ mi
     (0.8 km). The radius is stored in metres, so switching units picks the
     nearest step.
4. **People** (owner only, since the members list is owner-only on the
   server). The same invite form and member list as the Share dialog,
   moved into a shared component so both use it. Share trip stays in the
   drawer.
5. **Export.** "Download this trip" saves the trip document as
   `<trip-name>.json` (the Run 8 export, the same file Import takes).
   Needs a connection.
6. **At the bottom, apart and in red:** Delete trip (owner) or Leave trip
   (editor), with the same confirm dialog as the trips list. Afterwards,
   back to the trips list.

### Renaming

- **`PATCH /trips/{trip_id}`** with `{ "name": "…" }` (`TripUpdate`, extra
  fields rejected). It goes through `get_editable_trip` (owner and editor;
  a viewer gets 403, a stranger 404) and returns the `TripSummary`.
- **Last write wins** (Q4 answered). No version check.
- The new name shows at once in the trips list, the trip's top bar, and
  the saved offline copy.

### Distances

- `shared/units.js`: `useDistanceUnit()` (`"mi"` | `"km"`, stored under
  the key `distanceUnit`, default `"mi"`) and `distanceLabel(metres, unit)`
  ("0.3 mi" / "<0.1 mi", "450 m" / "1.2 km"). `milesLabel` is replaced
  by it. Weather keeps its own units: temperature isn't a distance (Q3).

### Opens on

- `trips/openOn.js`: `{ [tripId]: "today" | "timeline" | "map" }` under
  `openOn`. `tripHomePath(trip)` reads it. With no choice made, today's
  rule stands (Today, or the timeline once a trip is over). A trip that's
  over still opens where you chose, except Today, which falls back to the
  timeline because there's no "today" left on it (Q5).

### Cover

- **Emoji or photo** (Q6). A trip has at most one cover, shown on the left
  of its card on the trips list, at about 48 px square. No cover means the
  card looks as it does now.
- **On the server**, because everyone on the trip sees the same card:
  `trips.cover_emoji` (one emoji, validated as a single grapheme) and
  `trips.cover_photo_id` (a photo on this trip). Migration **0017**.
  They're set through the same `PATCH /trips/{id}` (`coverEmoji`,
  `coverPhotoId`, each nullable to clear; setting one clears the other).
  `TripSummary` gains `coverEmoji` and `coverThumbUrl`.
- **Picking a photo** shows a grid of the trip's photos (thumbnails), the
  same ones the journal shows you. Only photos on **public** memories can
  be picked (Q7). The card is seen by viewers too, so a private memory's
  photo mustn't end up there.
- **The photo goes away** (it's deleted, or its memory is made private or
  deleted) → the card falls back to no cover. This is checked when the trip
  is read, not stored.
- **Offline:** the emoji always shows. The photo shows if the phone has
  the thumbnail cached; otherwise there's an empty tile.

### The timeline keeps its place

- **What's remembered, per trip:** the view (Plan / Stays / Travel) and the
  scroll position. It's held in memory for as long as the app is open
  (`timeline/timelinePlace.js`, like the journal's `savedScroll`). Closing
  the app starts fresh (Q1).
- **Saved** when the timeline unmounts (any way out: the map, Today, the
  journal, an entry, a day). **Restored** when it mounts again: the view
  first, then the scroll in a layout effect once the rows are drawn, so
  there's no jump.
- **Opening the trip from the trips list** starts fresh, at the top of the
  Plan (that's "opening the trip", not "coming back"). So does tapping the
  Timeline tab while already on the timeline (Q1).
- **The map keeps its place too (Q9).** Today it fits the whole trip every
  time it opens. It gets the same treatment in Phase 100b: center, zoom and
  filters, per trip, in memory. Today is short enough not to need it.

## Phases

### Phase 100 — the timeline keeps its place

On its own and frontend only, so it goes first.

- `timelinePlace.js`: `rememberTimeline(tripId, { view, scrollTop })`,
  `takeTimelinePlace(tripId)`, `forgetTimeline(tripId)`.
- `TripTimelinePage`: start `view` from the remembered place, save on
  unmount, restore the scroll after the first render with rows. The trips
  list's links and the Timeline tab (when already there) forget it.

**Tests**

- Stays view, scrolled down, unmount, mount again: Stays, same scroll.
- Two trips keep their own places.
- From the trips list: Plan, at the top.
- The Timeline tab while on the timeline: back to the top.
- E2E at 375 px: Stays, scroll, Map tab, Timeline tab, then the same row is
  in view. A human checks it on a phone, including the entry page and
  Back.

### Phase 100b — the map keeps its place

- `map/mapPlace.js`, like `timelinePlace.js`: `{ center, zoom, only, date }`
  per trip, saved when the map unmounts.
- `MapPage`: when there's a saved place, start there with its filters and
  skip the first fit to the trip (`showView`). `?focus=<pin>` still wins:
  it opens at that pin, as now. Opening the trip from the trips list forgets
  the map's place too.

**Tests**

- Pan and zoom, set a filter, leave, come back: same center, zoom and
  filters, and no fit.
- `?focus=` ignores the saved place.
- Two trips keep their own; from the trips list, the trip-wide fit again.
- E2E: Map, pan, Timeline, Map, then the same view. A human checks it on a
  phone.

### Phase 101 — renaming, the cover, on the server

- `PATCH /trips/{trip_id}` (`name`, `coverEmoji`, `coverPhotoId`),
  `TripUpdate`, `update_trip` in `services/trips.py`.
- Migration 0017: `cover_emoji`, `cover_photo_id` (FK to `photos`,
  nullable).
- `TripSummary` / `TripRead`: `coverEmoji`, `coverThumbUrl` (null when the
  photo is gone or its memory isn't public).
- `tripsSlice`: `updateTrip` updates the list entry. The timeline slice's
  open trip and the offline copy update as well.

**Tests**

- Owner and editor can rename. Viewer: 403. Stranger: 404. Blank, too
  long, an extra field: 422. Trimmed.
- Cover: an emoji is accepted, but text or two emoji are 422. A photo from
  another trip, or on a private memory: 422. Setting one clears the other.
  null clears.
- The photo's memory is made private, or the photo is deleted: the summary
  gives no cover.
- Slice: the list and the open trip both show the new name.

### Phase 102 — the Trip settings page

- The route, `TripSettingsPage.jsx` (`features/trips/`), the ⋯ menu item
  (owner and editor).
- Sections: Cover (emoji picker: a short grid of travel emoji plus "type
  your own"; photo picker grid), Name, On this phone, People (owner),
  Export, Delete / Leave.
- `MembersPanel` is pulled out of `ShareTripDialog`, which now uses it too.
- The trip card shows the cover.

**Tests**

- The menu has Trip settings for owner and editor, not viewer. A viewer at
  the URL is sent back to the trip.
- Name: Save is disabled until it changes; saving dispatches and toasts;
  offline disables it.
- Cover: picking an emoji, picking a photo, clearing it. Only public photos
  are offered. The card shows each.
- People shows for the owner only, with the same behavior as the Share
  dialog (those tests now run against `MembersPanel`).
- Export downloads `<name>.json` from the export endpoint; it's disabled
  offline.
- Delete (owner) and Leave (editor): confirm, then the trips list.
- E2E `trip-settings.spec.js` at 375 px, dark and light. A human checks it
  on a phone.

### Phase 103 — on this phone: opens on, distances, nearby radius

- `trips/openOn.js` + `tripHomePath`. `shared/units.js`
  (`useDistanceUnit`, `distanceLabel`). `pointsOfInterest/nearbyRadius.js`
  (`useNearbyRadius(tripId)`), read by `NearbyPointsOfInterest`, whose
  heading says the radius ("Nearby · within 1 mi").
- The "On this phone" section on the settings page.

**Tests**

- Opens on: each choice gives the right path; no choice keeps today's
  rule; a past trip set to Today opens the timeline.
- Distances: labels in both units; switching units moves the radius to
  the nearest step.
- Radius: stored per trip (another trip keeps ½ mi); the Nearby list grows
  and shrinks with it; a bad stored value, or storage that throws, gives
  the default.
- `make verify` green; a human checks it on a phone.

## Open questions

Answered (Julian, 2026-10-12): last updated, dropped. Viewers don't get
the page. Radius steps as recommended. Renames: last write wins. No
"updated" line on the cards. Settings 2–7 are in, and dates / time zone are
out.

Second pass, all answered with the suggestion (Julian, 2026-10-12):

1. **The timeline's place: kept only while the app is open?** If you
   close the app (or the phone closes it) it opens fresh.
   *Suggestion:* yes, in memory only. When the app opens again, Today is
   where you'd want to start anyway. And opening a trip from the trips
   list, or tapping Timeline while already on it, starts at the top.
2. **Viewers and the per-phone settings.** With no settings page, a
   viewer can't change their radius, units or what opens first, so they
   get the defaults. OK? *Suggestion:* yes for now. Units could also go in
   the drawer next to Text size later, if a viewer asks.
3. **Distances: one choice for the whole phone (every trip), not per
   trip?** Weather stays as it is (°F with °C alongside).
   *Suggestion:* yes to both. A per-trip unit would be confusing.
4. **Opens on, for a trip that's over:** a trip set to "Today" opens the
   timeline once the trip has ended. Map and Timeline are kept as chosen.
   *Suggestion:* yes.
5. **Viewers' "opens on"** stays the timeline (the rule today), since they
   can't set it. *Suggestion:* yes.
6. **Cover: emoji, photo, or both?** *Suggestion:* both. The emoji works
   before there are any photos, and offline.
7. **Cover photos: only from public memories?** The card is seen by
   viewers too, so a private memory's photo would show to them.
   *Suggestion:* only public ones. The picker says so ("Only photos from
   memories everyone can see").
8. **People on the settings page: owner only?** The members list is
   owner-only on the server today. Editors could get a read-only list of
   who's on the trip, which needs a small change to that endpoint.
   *Suggestion:* owner only for now.
9. **Should the map keep its place too?** Today it zooms out to the whole
   trip every time you come back to it. Keeping its center, zoom and
   filters the same way would be a small Phase 100b.
   *Suggestion:* yes, it's the same complaint from the other side.
