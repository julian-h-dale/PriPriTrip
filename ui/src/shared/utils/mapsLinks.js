/**
 * Links that hand a place off to the phone's own maps app (Google Maps opens
 * the app when it's installed). Coordinates when we have them, else the
 * name and address as a search.
 */

/** Show the place. */
export function mapsUrl(loc) {
  if (loc.lat != null && loc.lng != null) {
    const placeId = loc.placeId ? `&query_place_id=${encodeURIComponent(loc.placeId)}` : "";
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}${placeId}`;
  }
  if (loc.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${loc.name}, ${loc.address}`)}`;
  }
  return null;
}

/** Directions to the place, from wherever the phone is. */
export function directionsUrl(loc) {
  if (loc.lat != null && loc.lng != null) {
    const placeId = loc.placeId ? `&destination_place_id=${encodeURIComponent(loc.placeId)}` : "";
    return `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}${placeId}`;
  }
  const text = [loc.name, loc.address].filter(Boolean).join(", ");
  return text ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text)}` : null;
}
