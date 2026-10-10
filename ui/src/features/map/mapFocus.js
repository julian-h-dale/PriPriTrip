/**
 * Opening the map at one pin from another page (Run stage 27):
 * `/trips/:id/map?focus=<marker id>`, with marker ids as buildMapMarkers
 * makes them (`poi-<id>`, `item-<id>`, `stay-<id>`, `travel-<id>-from`).
 */
export const FOCUS_PARAM = "focus";

export function mapFocusPath(tripId, markerId) {
  return `/trips/${tripId}/map?${FOCUS_PARAM}=${encodeURIComponent(markerId)}`;
}

/**
 * The map marker for one of an entry's places (`found` from findEntry;
 * `label` from describeEntry's locations: "Where", or "From"/"To" for a
 * leg), or null when it has none: a plan B activity isn't on the map.
 */
export function entryMarkerId({ kind, record, planB }, label) {
  if (kind === "activity") return planB ? null : `item-${record.id}`;
  if (kind === "stay") return `stay-${record.id}`;
  return `travel-${record.id}-${label === "From" ? "from" : "to"}`;
}
