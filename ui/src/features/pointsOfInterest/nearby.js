import { DEFAULT_RADIUS } from "@/shared/phoneSettings";
import { distanceMetres } from "@/shared/utils/distance";

/**
 * Nearby points of interest (Run stage 27): the trip's points of interest
 * close to an entry's place, shown on that entry's page. Worked out on the
 * phone from the saved trip, so it needs no network. How far it reaches is a
 * per-trip choice on this phone (Run stage 29, `useNearbyRadius`).
 */

/** How many rows show before "Show all". */
export const NEARBY_SHOWN = 8;

const located = (loc) => loc?.lat != null && loc?.lng != null;

/**
 * `[{ poi, metres }]`: the trip's points of interest within `radius` of
 * `location`, closest first. One that is the same Google place as
 * `location` is left out (it's the entry itself). Empty when `location`
 * has no coordinates.
 */
export function nearbyPointsOfInterest(trip, location, radius = DEFAULT_RADIUS) {
  if (!located(location)) return [];
  return (trip?.pointsOfInterest ?? [])
    .filter((poi) => located(poi.location))
    .filter((poi) => !(location.placeId && poi.location.placeId === location.placeId))
    .map((poi) => ({ poi, metres: distanceMetres(location, poi.location) }))
    .filter(({ metres }) => metres <= radius)
    .sort((a, b) => a.metres - b.metres || a.poi.name.localeCompare(b.poi.name));
}
