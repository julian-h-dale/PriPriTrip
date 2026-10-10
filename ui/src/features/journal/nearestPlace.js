import { buildMapMarkers } from "@/features/map/buildMapMarkers";
import { distanceMetres } from "@/shared/utils/distance";

export const NEAR_METRES = 250;

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

/**
 * Where a memory was written, in words. A trip place close by wins ("Near
 * Hotel Bern"); then what the server looked up ("Café Central · Innere
 * Stadt, Vienna", or just the area); else "Location attached" (the lookup
 * hasn't run yet, or found nothing).
 */
export function locationLabel(trip, location) {
  const near = nearestPlace(trip, location);
  if (near) return `Near ${near.title}`;
  const words = [location.placeName, location.placeArea].filter(Boolean);
  return words.length ? words.join(" · ") : "Location attached";
}

/** "±12 m": how sure the phone was of where it was; null when it didn't say. */
export function accuracyLabel(location) {
  return location?.accuracy != null ? `±${Math.round(location.accuracy)} m` : null;
}
