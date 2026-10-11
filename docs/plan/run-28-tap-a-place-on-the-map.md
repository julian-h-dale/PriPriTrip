# Run stage 28 — tapping a place on the map opens our card

Julian (2026-10-10): on the map, tapping one of Google's own places (a
café, a temple, a station: not one of our pins) opens Google's popup with
just the name and "View on Google Maps". Can we show our card instead, with
the Add buttons (point of interest, activity, …)?

**Status: complete.** Phase 99 built (2026-10-10). Branch
`map-place-info-window` (off `main` at `4d9cbd0`).

## Where we are

- **Google's popup is Google's, but we can turn it off.** Those place icons
  are "clickable icons" on the map. A tap on one fires the map's `click`
  event with a `placeId`. Calling `event.stop()` in that listener stops
  Google opening its popup. So yes, we control it. We don't listen to map
  clicks at all yet (`MapPage.jsx`).
- **Our card already exists.** A place picked in the map's search
  (`showPlace` in `MapPage.jsx`) drops a white "+" pin and opens our info
  window, `NewPlaceInfo` in `MapInfoContent.jsx`: photo, name, address,
  "Not in this trip", the Add actions that fit its Google types
  (`placeActions`), "More…", and Directions. "Add" opens the same forms as
  search does (`startAdd`).
- **What a tap gives us is only a `placeId` and a point.** The name,
  address, photo and types need a Place Details lookup. `googlePlaces.js`
  only looks places up through search suggestions today.

## Design

- **A tap on a Google place** → `event.stop()`, look the place up by its
  `placeId` (the same fields as `pick()`: name, address, city, location,
  first photo, types), then hand it to `showPlace`. From there it behaves
  exactly like a search pick: the white "+" pin, our card, the Add buttons,
  and the forms prefilled with the place.
- **No zoom jump.** A search pick zooms to street level, because you might
  be looking at the whole country. A tap is already where you're looking, so
  it only opens the card. `showPlace` gets a `{ zoom: false }` option. A tap
  near the top of the map moves the map down just enough for the card to
  open under the search bar (Google's own auto-pan only keeps it inside the
  map, where our controls cover it).
- **Already on the trip?** If the tapped `placeId` matches one of the trip's
  pins (an activity, stay, travel end or point of interest with the same
  Google place), open **that pin's** card, not "Not in this trip". Adding it
  twice is the mistake to stop.
- **Areas** (a town or district label, if Google makes one tappable) are
  handled as search already does (`isArea`): nothing to add, so no card.
- **While the lookup runs** (usually well under a second) nothing shows. If
  it fails, a toast: "Couldn’t load that place." No retry button.
- **Tapping empty map** (not a place) closes an open card, the way Google's
  maps do. Nothing else changes.
- **Viewers** get the same card without the Add actions (Q1).
- **Offline / "saved copies only"** need nothing new (Q2): the map tab is
  already the offline list of places then (`selectOnline` covers both), so
  there's no map to tap.
- **"Google Maps" link** next to Directions on a new place's card (Q3), for
  Google's own page (reviews, opening hours): `mapsUrl` with the place id.
- **Cost:** each tap is one Place Details lookup, plus a photo when the card
  shows one. Search already pays the same per pick. For two people on a trip
  this stays well inside Google's free monthly usage, but it's a new
  per-tap cost, so it's written down here.

## Phases

### Phase 99 — tapping a Google place opens our card

- `googlePlaces.js`: `placeDetails(placeId)` → the same plain place object
  as `pick()` (with `types`). It shares `pick()`'s field list and mapping,
  so the two can't drift.
- `MapPage.jsx`: a map `click` listener. With a `placeId`: `stop()`, match it
  against the trip's pins first, otherwise look it up and `showPlace(place,
  { zoom: false })`. Without one: close the card. Ignore an answer that
  comes back after a newer tap.
- Matching a tap to a pin uses the `placeId` the markers already carry
  (`buildMapMarkers`). It's a small pure helper with its own test.

**Tests**

- `placeDetails` maps Google's Place into our place object, the same shape
  as `pick()` (Places mocked, as the existing tests do).
- Map click with a `placeId`: Google's popup is stopped, the place is looked
  up, and our card shows its name with the Add buttons.
- A `placeId` that's already a trip pin opens that pin's card, with no lookup.
- A failed lookup shows the toast; a stale lookup (two quick taps) doesn't
  overwrite the newer card.
- A click with no `placeId` closes an open card.
- A viewer gets the card without Add actions; the card has a Google Maps link.
- A tap near the top pans the map down; one lower down doesn't.
- `make verify` green; e2e `map-tap.spec.js` taps a real Google place at
  375 px; a human taps a café, a station and a pin already on the trip on a
  phone.

## Built

### Phase 99 (2026-10-10): tapping a Google place opens our card

`make verify` green (309 API + 664 UI tests). E2E `map-tap.spec.js` (dark and light): the first
trip's map, taken to Bern through Google search, tapped in a grid until a
Google place is hit; our card opens, Google's (`.poi-info-window`) never
does; Point of interest opens the form with the place (screenshots `28a`,
`28b`). It uses whatever trip is first and saves nothing, so it runs on a
dev database with real trips (no `make seed`).
- `placeDetails(placeId)` in `googlePlaces.js` shares `pick()`'s fields and
  mapping (`ourPlace`), tested in `googlePlaces.test.js`.
- `markerForPlace` in `features/map/tappedPlace.js`: a shown pin wins over
  one the filters hide. A hidden one opens its card at its position.
- `MapPage.jsx`: `onMapClick` (through `mapClickRef`, so the listener added
  once sees current state), a tap counter so a late lookup is dropped,
  `showPlace(place, { zoom: false })`, and `makeRoomAbove`.
- Seen in the first e2e run: a card for a place near the top opened behind
  the search bar. Hence `makeRoomAbove` (`TAP_CARD_ROOM_PX` = 380).
- Like a search pick, the tapped place's name shows in the search box, and
  its clear button removes the white pin.

## Open questions — answered (Julian, 2026-10-10: "go with your suggestions")

1. **Viewers** (they can't add): show our card without the Add buttons
   (name, address, photo, Directions), or leave Google's own popup?
   *Suggestion:* our card, so the map looks the same for everyone.
   → Our card.
2. **Offline / data saver:** the lookup needs the network. Leave Google's
   popup alone when we're offline or in "saved copies only", rather than
   showing a card that can't load? *Suggestion:* yes, only take over taps
   when online and not in data saver.
   → Yes (already so: no map is shown then).
3. **Google's popup also has "View on Google Maps"**, which opens Google's
   full page (reviews, opening hours). Our card only has Directions. Add a
   "Google Maps" link next to Directions? *Suggestion:* yes, it's the one
   thing we'd otherwise lose.
   → Yes.
