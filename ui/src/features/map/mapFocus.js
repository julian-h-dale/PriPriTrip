/**
 * Opening the map at one pin from another page (Run stage 27):
 * `/trips/:id/map?focus=<marker id>`, with marker ids as buildMapMarkers
 * makes them (`poi-<id>`, `item-<id>`, `stay-<id>`, `travel-<id>-from`).
 */
export const FOCUS_PARAM = "focus";

export function mapFocusPath(tripId, markerId) {
  return `/trips/${tripId}/map?${FOCUS_PARAM}=${encodeURIComponent(markerId)}`;
}
