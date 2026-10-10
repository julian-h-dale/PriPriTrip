# Run stage 27 — nearby points of interest on an entry's page

Julian (2026-10-09): some activities cover several places close together.
The Beitou afternoon is the Hot Spring Museum, Thermal Valley and the hot
springs. Version 1 had a list of locations on an activity. Rather than bring
that back, keep the activity's one place and show the trip's **points of
interest nearby** on its page. Then the museum is the activity's place, and
Thermal Valley and the hot springs are points of interest that show up by
themselves.

Also asked: tapping the mini map on an entry's page should open the map,
zoomed in on that place (Phase 98).

**Status: complete.** Phases 97–98 built (2026-10-09). Branch
`nearby-points-of-interest` (off `main` at `2d0e63f`).

## Where we are

- **An entry's page** (`features/entry/EntryPage.jsx`, `EntryView`): the
  photo, confirmation, when, facts, notes, then each place (`PlaceRow`)
  with a `MiniMap` under it when online.
- **Points of interest** (Run 16) are on the trip (`trip.pointsOfInterest`,
  each with a place that has coordinates). They show only on the map, and
  they're in the phone's saved copy of the trip.
- **Distance:** `distanceMetres` (haversine) is already used by the
  journal's "Near …" label.
- **The map** (`features/map/MapPage.jsx`): `selectMarker` zooms to a pin
  and opens its info window. There's no way yet to open the map *at* a pin
  from another page.

## Design

### Nearby (Phase 97)

- **Where:** a **Nearby** section on the page of an **activity or a stay**,
  under its place and mini map. Not travel: what's near an airport or
  station is rarely what you want.
- **What:** the trip's points of interest within **0.5 mile (805 m)** of
  the entry's place, closest first. A point of interest that *is* the
  entry's place (same Google place) is left out.
- **Each row:** the category's icon, the name, and the distance in miles
  ("0.3 mi"; under 0.1 mile reads "<0.1 mi"). Miles, like the weather page.
- **Cap:** the first 8, then "Show all N" opens the rest in place.
- **Tapping a row** opens the map at that pin with its info window open
  (`/trips/:id/map?focus=poi-<id>`).
- **Hidden** when the entry's place has no coordinates or nothing is in
  range.
- **Offline:** it works from the saved trip, so it shows offline too.
- **Everyone** sees it, viewers included.
- No server change, no migration.

### The map opened at a pin

`MapPage` reads `?focus=<marker id>` once the map is ready: it selects
that marker (zoom 15, info window open), then removes the parameter so a
reload or Back doesn't jump again. An unknown id leaves the normal view.

### Tapping the mini map (Phase 98)

The mini map on an entry's page becomes a link to the map with
`?focus=<that entry's marker>` (`item-<id>`, `stay-<id>`,
`travel-<id>-from|to`), using Phase 97's `focus`. Plan B activities aren't
on the map, so their mini map stays a plain picture.

## Phases

### Phase 97 — Nearby on an entry's page

- **Scope:** `nearbyPointsOfInterest(trip, location)` and `milesLabel`
  (`features/pointsOfInterest/nearby.js`; `distanceMetres` moves to
  `shared/utils/distance.js`); the Nearby section in `EntryView` for
  activities and stays; `?focus=` on the map.
- **Tests:**
  - In range and out of range; nearest first; the same place left out;
    no coordinates gives nothing.
  - Miles labels.
  - The section shows for an activity and a stay, not for travel; it's
    hidden when nothing is near; the cap and "Show all".
  - Rows link to the map with `focus`.
  - The map opens at a focused pin with its info window, and drops the
    parameter.
- **Phone width:** the Beitou activity's page at 375 px.

### Phase 98 — tapping the mini map opens the map there

- **Scope:** the mini map is a link with `?focus=` for activities, stays
  and each end of a travel leg; not for plan B.
- **Tests:** each kind links to its marker id; plan B has no link.

## Built

### Phase 97 (2026-10-09): Nearby on an entry's page

`make verify` green (309 API + 646 UI tests). E2E `nearby.spec.js`: three
points of interest near Kornhauskeller (one outside half a mile), the
section at 375 px dark and light, then a row opens the map on that pin
(screenshots `27a`, `27b`).
- `features/pointsOfInterest/nearby.js` (`nearbyPointsOfInterest`,
  `milesLabel`) and `NearbyPointsOfInterest.jsx`; `distanceMetres` is now in
  `shared/utils/distance.js`.
- **The map at a pin:** `features/map/mapFocus.js` (`mapFocusPath`). With
  `?focus=` the map is *created* at that pin at zoom 15 and skips the
  trip-wide fit: in a real browser the fit landed after the focus and
  undid it (seen in the first e2e run; jsdom can't show it).
- **Info windows survive a pin rebuild:** memories arriving rebuild the
  pins, which used to leave an open info window on a removed marker; it's
  now re-anchored to the new one (`openMarkerIdRef`).

### Phase 98 (2026-10-09): tapping the mini map opens the map there

`make verify` green (309 API + 649 UI tests). E2E `nearby.spec.js` now also taps Kornhauskeller's
mini map and checks the map opens on the dinner's pin (screenshot `27c`).
- `entryMarkerId(found, label)` in `mapFocus.js`; `EntryMiniMap` in
  `EntryPage.jsx` wraps the map in a link labelled "Show <place> on the
  map", with a transparent cover so Google's map never takes the tap.
- A plan B activity's mini map stays a picture (no pin on the map). No
  coordinates, or offline: no mini map, so no link.

## Later

- **The radius per trip** (asked 2026-10-09): see the answer in chat; to
  plan once Phase 97 has been tried.

## Open questions — answered (Julian, 2026-10-09: "go with your suggestions")

1. Radius: 0.5 mile, closest first, capped at 8 with "Show all".
2. Which entries: activities and stays, not travel.
3. Units: miles, as on the weather page.
4. Only points of interest, not the trip's other activities.
