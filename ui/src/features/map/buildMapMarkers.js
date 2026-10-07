import { datePart } from "@/shared/utils/time";

/**
 * Every located place in the trip, flattened for the map: one marker per
 * stay, per travel endpoint (from and to), per activity with a place, and
 * per point of interest (always located; on no day, so `day` is null).
 * Pure — no React, no Google Maps — so it's easy to test independently of
 * the map widget itself.
 */

function markerFromLocation(loc, { id, kind, mode, end, category, notes, day, endDay, legDays, entryId, title }) {
  if (loc?.lat == null || loc?.lng == null) return null;
  return {
    id,
    kind, // "stay" | "travel" | "activity" | "poi" (a point of interest)
    mode: mode ?? null, // a travel's mode (flight, train, ...); null otherwise
    // A point of interest's category (shop, market, ...) and notes; null otherwise.
    category: category ?? null,
    notes: notes ?? null,
    lat: loc.lat,
    lng: loc.lng,
    title,
    // The location's own name: a leg's two ends share its title, so this
    // tells them apart (the map's List).
    placeName: loc.name ?? null,
    // A travel endpoint's end of the leg: "from" | "to"; null otherwise.
    end: end ?? null,
    city: loc.city ?? null,
    imgRef: loc.imgRef ?? null,
    placeId: loc.placeId ?? null,
    address: loc.address ?? null,
    day, // the trip date this marker belongs to, for "view that day"
    // A stay's last covered night, exclusive (datePart(checkOut)) — lets the
    // calendar filter match any night it covers, not just check-in day.
    // Absent for travel/activity markers.
    endDay: endDay ?? null,
    // A travel endpoint's leg: [departure date, arrival date]. Both ends match
    // every day the leg travels on. Null for stays and activities.
    legDays: legDays ?? null,
    // The stay's, leg's, activity's or point of interest's own id.
    entryId: entryId ?? null,
  };
}

export function buildMapMarkers(trip) {
  const markers = [];

  for (const stay of trip.stays ?? []) {
    const marker = markerFromLocation(stay.location, {
      id: `stay-${stay.id}`,
      kind: "stay",
      entryId: stay.id,
      day: datePart(stay.checkIn),
      endDay: datePart(stay.checkOut),
      title: stay.name,
    });
    if (marker) markers.push(marker);
  }

  for (const travel of trip.travels ?? []) {
    // Both ends belong to every day the leg travels on (mapFilters).
    const legDays = [datePart(travel.depart), datePart(travel.arrive ?? travel.depart)];
    const from = markerFromLocation(travel.from, {
      id: `travel-${travel.id}-from`,
      kind: "travel",
      end: "from",
      entryId: travel.id,
      mode: travel.mode,
      day: datePart(travel.depart),
      legDays,
      title: travel.title,
    });
    if (from) markers.push(from);

    const to = markerFromLocation(travel.to, {
      id: `travel-${travel.id}-to`,
      kind: "travel",
      end: "to",
      entryId: travel.id,
      mode: travel.mode,
      day: datePart(travel.arrive ?? travel.depart),
      legDays,
      title: travel.title,
    });
    if (to) markers.push(to);
  }

  for (const day of trip.days ?? []) {
    for (const item of day.items) {
      const marker = markerFromLocation(item.location, {
        id: `item-${item.id}`,
        kind: "activity",
        entryId: item.id,
        day: day.date,
        title: item.title,
      });
      if (marker) markers.push(marker);
    }
  }

  for (const poi of trip.pointsOfInterest ?? []) {
    const marker = markerFromLocation(poi.location, {
      id: `poi-${poi.id}`,
      kind: "poi",
      entryId: poi.id,
      category: poi.category,
      notes: poi.notes,
      day: null,
      title: poi.name,
    });
    if (marker) markers.push(marker);
  }

  return markers;
}
