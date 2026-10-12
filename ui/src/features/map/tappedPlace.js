/**
 * One of Google's own places tapped on the map (Run stage 28): is it already
 * on the trip? Matched by Google place id, the one thing a tap gives us.
 */

/**
 * The trip marker that is this Google place, or null. A place can be more
 * than one marker (a round trip's airport is both legs' end); one the map
 * shows now wins over one the filters hide.
 */
export function markerForPlace(markers, visible, placeId) {
  if (!placeId) return null;
  const same = (m) => m.placeId === placeId;
  return visible.find(same) ?? markers.find(same) ?? null;
}
