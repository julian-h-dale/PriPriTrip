/**
 * The map's "what" filter (House: stays only; Journal: memories only) and
 * its Calendar filter (one day). The two "what" choices are either-or; the
 * date narrows whichever is active. Pure, so it's testable without the map
 * widget itself.
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

/** Whether a marker belongs to the "what" filter: `"stays"` and `"memories"`
 * keep only that kind; no filter keeps the trip's places but not memories,
 * which show only when asked for. */
function markerMatchesOnly(marker, only) {
  if (only === "stays") return marker.kind === "stay";
  if (only === "memories") return marker.kind === "memory";
  return marker.kind !== "memory";
}

/** Markers left after the active filters. `only`: null | "stays" | "memories". */
export function filterMarkers(markers, { only = null, date = null } = {}) {
  return markers.filter((m) => markerMatchesOnly(m, only) && markerMatchesDate(m, date));
}
