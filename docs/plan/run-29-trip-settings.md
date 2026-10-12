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

**Status: complete.** Phases 100–103 built (2026-10-12). Branch
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
     mi, or 0.5 · 1 · 2 · 3 km when Distances is km. The default is ½ mi,
     which is 1 km in km (the nearest step to 0.8 km). The radius is stored
     in metres, so switching units picks the nearest step.
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

- `shared/phoneSettings.js`: `useDistanceUnit()` (`"mi"` | `"km"`, stored under
  the key `distanceUnit`, default `"mi"`) and `distanceLabel(metres, unit)`
  ("0.3 mi" / "<0.1 mi", "450 m" / "1.2 km"). `milesLabel` is replaced
  by it. Weather keeps its own units: temperature isn't a distance (Q3).

### Opens on

- `shared/phoneSettings.js`: `{ [tripId]: "today" | "timeline" | "map" }` under
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
- Migration 0017: `cover_emoji`, `cover_photo_id` (nullable; no foreign
  key, for the same reason `updated_by` has none: SQLite can't add one to
  `trips` without a rebuild its children's keys forbid).
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

- `shared/phoneSettings.js` (`useOpenOn`, `useDistanceUnit`,
  `distanceLabel`, `useNearbyRadius(tripId)`) + `tripHomePath`. The radius
  is read by `NearbyPointsOfInterest`, whose
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

## Built

### Phase 100 (2026-10-12): the timeline keeps its place

`make verify` green (311 API + 671 UI). E2E `timeline-place.spec.js` (dark
and light, 375 × 520 so five days scroll): Stays, scroll to the bottom, Map,
Timeline, then Stays at the same scroll; Timeline again, then the top of
Plan (screenshot `29a`).
- `shared/tripPlaces.js`: `rememberPlace` / `savedPlace` / `forgetPlaces`,
  keyed by screen and trip, for the map's place in 100b too.
- `TripTimeline` tracks the scroll root's `scrollTop` while it scrolls (the
  root belongs to the page being left, so it can't be read at unmount) and
  saves `{ view, scrollTop }` on unmount.
- Timeline tab while on the timeline: the link carries
  `state.timelineTop`, acted on only for a navigation after mount, so Back
  to that history entry later doesn't reset it.
- Found while testing: a trip read that turns you into a viewer while a
  saved place says Stays left the rows in Stays mode with no buttons. Now
  a viewer's view is always the plan.
- The trip card's link forgets the trip's places. The landing page (`/`)
  doesn't need to: it's only reached when the app starts, and memory is
  empty then.

### Phase 100b (2026-10-12): the map keeps its place

`make verify` green (311 API + 674 UI). E2E `map-place.spec.js`: Stays,
drag the map, Timeline, Map, then the same filter with a hotel's pin on the
same spot of the screen (screenshot `29b`).
- `MapPage` reads `savedPlace("map", …)` once, unless opened with
  `?focus=`, to start its filters and the map's center and zoom, and skips
  the first `showView`. The init effect's cleanup saves
  `{ center, zoom, only, date }` from the map (`filtersRef` for the
  filters as of then).
- The trips list's `forgetPlaces` (Phase 100) already clears it.

### Phase 101 (2026-10-12): renaming and the cover, on the server

`make verify` green (328 API + 677 UI).
- `PATCH /trips/{id}` (`TripUpdate`: `name`, `coverEmoji`, `coverPhotoId`;
  `extra="forbid"`; `name: null` and both covers at once are 422). The
  role in the reply is the caller's (owner or editor).
- `is_one_emoji` in `schemas.py`: one pictograph, a flag, a keycap, or a
  ZWJ sequence, with skin tones and variation selectors. It's not a full
  grapheme check, but it rejects words and two emoji.
- `_shown_cover_photo`: a live photo on this trip, on a live public memory.
  Used to accept a cover (else 422 "Pick a photo from a memory everyone can
  see."), and again on every read, so `coverThumbUrl` goes null when the
  photo or memory is deleted or made private. The list uses it as a
  correlated subquery.
- `updateTrip` (`tripsSlice`): updates the list and the open trip
  (`timelineSlice`), and both saved copies (trip and list), then shows the
  "Saved" toast. Rejected with the server's message.
- One change from the plan: no foreign key on `cover_photo_id` (above).

### Phase 102 (2026-10-12): the Trip settings page

`make verify` green (328 API + 690 UI). E2E `trip-settings.spec.js` (dark
and light): ⋯ → Trip settings on the sample trip (under Past), pick 🏔️,
rename, Back, and the card shows both; put back after (screenshots `29c`,
`29d`).
- `TripSettingsPage` (`features/trips/`), at `/trips/:tripId/settings`
  inside `NotForViewers`, in `ToolLayout`. Sections are cards with headings
  (regions): Cover, Name, People (owner), Export, Delete / Leave. "On this
  phone" comes in Phase 103, between Name and People.
- Cover: Emoji | Photo toggle. 24 travel emoji plus "Or type one" (the
  server checks it's one emoji). The photo grid comes from the journal
  (`fetchMemories`): public, uploaded photos only. Remove cover sends both
  as null. Each pick saves at once (no Save button).
- `MembersPanel` (`features/sharing/`) is the Share dialog's body, pulled
  out; `ShareTripDialog` wraps it. Its tests still run through the dialog.
- Export: `GET /trips/{id}/export` as a blob, then `saveToPhone` (the share
  sheet on a phone, else a download) as `<slug>.json`, the server's slug.
- Delete / Leave: the same confirm wording as the trips list, then
  `/trips`.
- The card: `TripCover` (48 px tile, emoji or `usePhotoSrc` thumbnail) left
  of the name. ⋯ has Trip settings above Delete / Leave, but not for a
  viewer.
- Also: the page counts in analytics as "Trip settings"
  (`/trip/settings`), like every other page.
- **Testing note:** Julian's own dev API on :8000 had been running since
  2026-10-07 without `--reload`, so it didn't have `PATCH /trips/{id}`. It
  was left alone. E2E ran against this branch's servers on :8010 / :3010,
  through new `E2E_API_PORT` / `E2E_UI_PORT` overrides in
  `playwright.config.js`. The headless Chromium on the Pi has no colour
  emoji font, so emoji show as boxes in the screenshots. Phones render
  them.

### Phase 103 (2026-10-12): on this phone

`make verify` green (328 API + 700 UI). E2E `trip-settings.spec.js` now
also sets Opens on: Map, and the card then opens the map. `nearby.spec.js`
and `timeline-place.spec.js` still pass.
- One module, `shared/phoneSettings.js`, holds all three (the plan named
  separate files). `tripHomePath` lives in `shared/` and reads "opens on",
  so the store had to be in `shared/` too, and the radius depends on the
  unit. Same localStorage pattern as `planChoice.js`: per-trip JSON objects,
  an in-memory fallback when storage throws, `useSyncExternalStore`.
- "Opens on" shows the trip's current default (Today, or Timeline once
  it's over) until a choice is made. `tripHomePath(trip, now, choice)`:
  viewer gives the timeline; Map gives the map; Timeline, or a trip that's
  over, gives the timeline; otherwise Today.
- The radius: only the eight steps count (else ½ mi). Shown as the nearest
  step in the current unit. ½ mi in km is **1 km** (the plan said "0.8 km",
  which isn't one of the km steps).
- Nearby's label: "Nearby · within ½ mi" (the region's name stays
  "Nearby"). Distances use `distanceLabel`.

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
