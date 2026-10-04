/** Local, free-text matching against the map's own markers — no network
 * call. Used first; a live Places search is only a fallback for orientation
 * when nothing here matches. Pure, so it's testable on its own. */
export function matchMarkers(markers, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return markers.filter(
    (m) => m.title.toLowerCase().includes(q) || (m.city && m.city.toLowerCase().includes(q))
  );
}
