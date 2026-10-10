import { distanceMetres } from "@/shared/utils/distance";

/**
 * Nearby points of interest (Run stage 27): the trip's points of interest
 * close to an entry's place, shown on that entry's page. Worked out on the
 * phone from the saved trip, so it needs no network.
 */

const METRES_PER_MILE = 1609.344;

/** How close counts as nearby: half a mile, a short walk. */
export const NEARBY_METRES = METRES_PER_MILE / 2;

/** How many rows show before "Show all". */
export const NEARBY_SHOWN = 8;

const located = (loc) => loc?.lat != null && loc?.lng != null;

/**
 * `[{ poi, metres }]`: the trip's points of interest within `radius` of
 * `location`, closest first. One that is the same Google place as
 * `location` is left out (it's the entry itself). Empty when `location`
 * has no coordinates.
 */
export function nearbyPointsOfInterest(trip, location, radius = NEARBY_METRES) {
  if (!located(location)) return [];
  return (trip?.pointsOfInterest ?? [])
    .filter((poi) => located(poi.location))
    .filter((poi) => !(location.placeId && poi.location.placeId === location.placeId))
    .map((poi) => ({ poi, metres: distanceMetres(location, poi.location) }))
    .filter(({ metres }) => metres <= radius)
    .sort((a, b) => a.metres - b.metres || a.poi.name.localeCompare(b.poi.name));
}

/** "0.3 mi", or "<0.1 mi" for anything closer. */
export function milesLabel(metres) {
  const miles = metres / METRES_PER_MILE;
  return miles < 0.05 ? "<0.1 mi" : `${miles.toFixed(1)} mi`;
}
