/**
 * The map's House (stays only) and Calendar (one day) filters — combinable,
 * not mutually exclusive, so both active means "stays happening on that
 * day". Pure, so it's testable without the map widget itself.
 */

/** Whether a marker is relevant on `date`: a stay matches any night it
 * covers (check-in through the night before check-out, via `endDay`);
 * everything else matches only its own `day`. No date filter matches all. */
export function markerMatchesDate(marker, date) {
  if (!date) return true;
  if (marker.kind === "stay" && marker.endDay) {
    return marker.day <= date && date < marker.endDay;
  }
  return marker.day === date;
}

/** Markers left after the active filters. */
export function filterMarkers(markers, { stayOnly = false, date = null } = {}) {
  return markers.filter((m) => (!stayOnly || m.kind === "stay") && markerMatchesDate(m, date));
}
