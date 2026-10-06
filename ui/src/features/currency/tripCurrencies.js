import { ZONE_CURRENCY } from "@/features/currency/zoneCurrency";
import { tonight } from "@/features/today/todayView";

/** Conversions always start from US dollars. */
export const HOME = "USD";

export const currencyOfZone = (zone) => (zone ? (ZONE_CURRENCY[zone] ?? null) : null);

/**
 * The trip's local currencies, in itinerary order, without USD: each stay's,
 * each leg's arrival and each activity's, from the zone the server computed
 * for its place (Okinawa then Taipei: JPY, TWD). Falls back to the trip's own
 * zone when nothing has a place.
 */
export function tripCurrencies(trip) {
  const stops = [];
  for (const stay of trip.stays ?? []) stops.push([stay.checkIn, stay.zone ?? stay.timezone]);
  for (const travel of trip.travels ?? []) {
    stops.push([travel.arrive ?? travel.depart, travel.arriveZone ?? travel.arriveTimezone]);
  }
  for (const day of trip.days ?? []) {
    for (const item of day.items ?? []) stops.push([item.start ?? `${day.date}T12:00`, item.zone ?? item.timezone]);
  }
  stops.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const codes = [];
  for (const [, zone] of stops) {
    const code = currencyOfZone(zone);
    if (code && code !== HOME && !codes.includes(code)) codes.push(code);
  }
  if (codes.length === 0) {
    const own = currencyOfZone(trip.timezone);
    if (own && own !== HOME) codes.push(own);
  }
  return codes;
}

/** The currency where you sleep on `date` (a trip date), if it's a local one. */
export function currencyOn(trip, date) {
  const { stay, checkingOut } = tonight(trip, date);
  const where = stay ?? checkingOut;
  const code = where ? currencyOfZone(where.zone ?? where.timezone) : null;
  return code && code !== HOME ? code : null;
}

