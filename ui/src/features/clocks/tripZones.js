import { datePart, zoneLabel } from "@/shared/utils/time";

/**
 * Every time zone a trip passes through, in the order the trip reaches it,
 * each named by its places: [{ zone, places: ["Naha", "Onna"] }]. Built from
 * the zones the server already worked out for each time (travel ends, stays,
 * activities), so it agrees with the timeline. A trip with none of those is
 * just its own timezone.
 */
export function tripZones(trip) {
  const seen = []; // [date, zone, place | null], in trip order
  const tz = trip.timezone;
  for (const t of trip.travels ?? []) {
    seen.push([datePart(t.depart), t.departZone ?? tz, placeName(t.from)]);
    seen.push([datePart(t.arrive ?? t.depart), t.arriveZone ?? tz, placeName(t.to)]);
  }
  for (const s of trip.stays ?? []) seen.push([datePart(s.checkIn), s.zone ?? tz, placeName(s.location)]);
  for (const day of trip.days ?? []) {
    for (const item of day.items ?? []) seen.push([day.date, item.zone ?? tz, placeName(item.location)]);
  }
  seen.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // stable: same day keeps order

  const byZone = new Map();
  for (const [, zone, place] of seen) {
    if (!byZone.has(zone)) byZone.set(zone, []);
    const places = byZone.get(zone);
    if (place && !places.includes(place)) places.push(place);
  }
  if (byZone.size === 0) byZone.set(tz, []);
  return [...byZone].map(([zone, places]) => ({ zone, places }));
}

/** A place's city, else its name (an airport, a hotel); null without one. */
function placeName(loc) {
  return loc?.city || loc?.name || null;
}

/** "Naha · Onna · +2", else the zone's own city ("Tokyo"). */
export function zoneTitle({ zone, places }, max = 2) {
  if (!places.length) return zoneLabel(zone);
  const more = places.length - max;
  return [...places.slice(0, max), ...(more > 0 ? [`+${more}`] : [])].join(" · ");
}
