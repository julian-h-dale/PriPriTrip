import { formatDayHeading } from "@/shared/utils/time";

/**
 * The map's List (Run stage 16): the markers on the map, grouped by kind for
 * a dialog. Pure, so it's testable without the map. Each group in trip order
 * (by day; markers already come in the trip's own order within a day), and
 * points of interest, which have no day, A–Z.
 */
const GROUPS = [
  ["stay", "Stays"],
  ["activity", "Activities"],
  ["travel", "Travel"],
  ["poi", "Points of interest"],
  ["memory", "Journal"],
];

// Stable, so within a day markers keep the order they came in (the trip's own).
const byDay = (a, b) => (a.day ?? "").localeCompare(b.day ?? "");
const byTitle = (a, b) => a.title.localeCompare(b.title);

/** `[{ kind, label, markers }]`, only the kinds that have any. */
export function groupMarkers(markers) {
  return GROUPS.map(([kind, label]) => {
    const mine = markers.filter((m) => m.kind === kind);
    return { kind, label, markers: [...mine].sort(kind === "poi" ? byTitle : byDay) };
  }).filter((g) => g.markers.length > 0);
}

/** The line under a marker's name: where it is (a leg's end, an address), or a memory's when. */
export function markerSubtitle(marker) {
  if (marker.kind === "memory") return [formatDayHeading(marker.day), marker.time].filter(Boolean).join(" · ");
  if (marker.kind === "travel") {
    const where = marker.placeName ?? marker.city;
    return where ? `${marker.end === "to" ? "To" : "From"} ${where}` : null;
  }
  if (marker.address) return marker.address;
  if (marker.placeName && marker.placeName !== marker.title) return marker.placeName;
  return marker.city ?? null;
}
