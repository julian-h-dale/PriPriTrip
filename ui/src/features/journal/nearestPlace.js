import { buildMapMarkers } from "@/features/map/buildMapMarkers";

const EARTH_RADIUS_M = 6_371_000;
export const NEAR_METRES = 250;

/** Great-circle distance in metres (haversine). */
export function distanceMetres(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * The trip's own place (stay, travel endpoint, activity) closest to `point`,
 * if one is within `NEAR_METRES` — "near Hotel Goldener Schlüssel". Works
 * offline and costs nothing; null when nothing on the trip is that close.
 */
export function nearestPlace(trip, point) {
  if (!trip || !point) return null;
  let best = null;
  for (const marker of buildMapMarkers(trip)) {
    const metres = distanceMetres(point, marker);
    if (metres <= NEAR_METRES && (!best || metres < best.metres)) best = { title: marker.title, metres };
  }
  return best;
}

/** Where a memory was written, in words: the nearby trip place, else just "attached". */
export function locationLabel(trip, location) {
  const near = nearestPlace(trip, location);
  if (near) return `Near ${near.title}`;
  return location.accuracy != null ? `Location attached (±${Math.round(location.accuracy)} m)` : "Location attached";
}
