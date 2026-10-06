import { datePart } from "@/shared/utils/time";

/**
 * An entry's own page (Run stage 13): one address per activity, stay and
 * travel leg, by its id, so Back, reloads and links all work.
 *
 *   /trips/:tripId/activities/:id   /trips/:tripId/stays/:id   /trips/:tripId/travel/:id
 */
export const ENTRY_SEGMENT = { activity: "activities", stay: "stays", travel: "travel" };

export function entryPath(tripId, kind, id) {
  return `/trips/${tripId}/${ENTRY_SEGMENT[kind]}/${id}`;
}

/** The page for a timeline entry (a row, a marker): its activity, stay or leg. */
export function entryPathFor(tripId, entry) {
  if (entry.kind === "activity") return entryPath(tripId, "activity", entry.item.id);
  if (entry.kind === "stay") return entryPath(tripId, "stay", entry.stay.id);
  return entryPath(tripId, "travel", entry.travel.id);
}

/**
 * The live record for a page, from the loaded trip: `{ kind, record, date }`
 * (`date`: the day it belongs to, where Back goes when there's no history),
 * or null when it isn't in the trip (deleted, or never was).
 */
export function findEntry(trip, kind, id) {
  if (kind === "activity") {
    for (const day of trip.days ?? []) {
      const item = day.items?.find((i) => i.id === id);
      if (item) return { kind, record: item, date: day.date };
    }
    return null;
  }
  if (kind === "stay") {
    const stay = trip.stays?.find((s) => s.id === id);
    return stay ? { kind, record: stay, date: datePart(stay.checkIn) } : null;
  }
  const travel = trip.travels?.find((t) => t.id === id);
  return travel ? { kind, record: travel, date: datePart(travel.depart) } : null;
}
