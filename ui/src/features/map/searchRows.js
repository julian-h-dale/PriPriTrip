/**
 * The map search's suggestion list: the trip's own matches first, then
 * Google's "new place" suggestions, never interleaved. A Google suggestion for
 * a place the trip already has (same place id) is dropped, so a saved place
 * never shows twice.
 *
 *   { type: "trip", key, marker }
 *   { type: "place", key, suggestion }   — suggestion: { placeId, primary, secondary }
 */
export function searchRows(tripMatches, suggestions, markers) {
  const saved = new Set(markers.map((m) => m.placeId).filter(Boolean));
  return [
    ...tripMatches.map((marker) => ({ type: "trip", key: `trip:${marker.id}`, marker })),
    ...suggestions
      .filter((s) => !saved.has(s.placeId))
      .map((suggestion) => ({ type: "place", key: `place:${suggestion.placeId}`, suggestion })),
  ];
}
