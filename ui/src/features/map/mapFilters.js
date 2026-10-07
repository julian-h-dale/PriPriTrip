/**
 * The map's "what" filter (the Filter menu: everything, stays, points of
 * interest, or journal memories, one at a time) and its Calendar filter
 * (one day), which narrows whichever is active. Pure, so it's testable
 * without the map widget itself.
 */

/** Whether a marker is relevant on `date`: a stay matches any night it
 * covers (check-in through the night before check-out, via `endDay`); both
 * ends of a travel leg match every day it travels on (departure through
 * arrival, via `legDays`), so an overnight flight shows whole on either day;
 * everything else matches only its own `day`. No date filter matches all. */
export function markerMatchesDate(marker, date) {
  if (!date) return true;
  if (marker.kind === "travel" && marker.legDays) {
    return marker.legDays[0] <= date && date <= marker.legDays[1];
  }
  if (marker.kind === "stay" && marker.endDay) {
    return marker.day <= date && date < marker.endDay;
  }
  return marker.day === date;
}

/** Whether a marker belongs to the "what" filter: `"stays"`, `"pois"` and
 * `"memories"` keep only that kind; no filter keeps the trip's places and
 * points of interest but not memories, which show only when asked for. */
function markerMatchesOnly(marker, only) {
  if (only === "stays") return marker.kind === "stay";
  if (only === "pois") return marker.kind === "poi";
  if (only === "memories") return marker.kind === "memory";
  return marker.kind !== "memory";
}

/** Markers left after the active filters. `only`: null | "stays" | "pois" | "memories". */
export function filterMarkers(markers, { only = null, date = null } = {}) {
  return markers.filter((m) => markerMatchesOnly(m, only) && markerMatchesDate(m, date));
}

/**
 * Where the map should look for these filters: `{ kind: "bounds", points }`
 * to fit two or more places, `{ kind: "point", point }` to centre on one,
 * or null (nothing to show: leave the view alone).
 *
 * With no filter it's the trip's destinations (stays and activities), not
 * travel's endpoints, which are often a continent away. Once a day is picked,
 * that day's travel counts too: a flight day shows the flight, even if that
 * means two countries.
 */
export function viewFor(markers, { only = null, date = null } = {}) {
  let shown = filterMarkers(markers, { only, date });
  if (!date && !only) {
    const anchors = shown.filter((m) => m.kind !== "travel");
    if (anchors.length) shown = anchors;
  }
  const points = [];
  for (const { lat, lng } of shown) {
    if (!points.some((p) => p.lat === lat && p.lng === lng)) points.push({ lat, lng });
  }
  if (points.length === 0) return null;
  if (points.length === 1) return { kind: "point", point: points[0] };
  return { kind: "bounds", points };
}
