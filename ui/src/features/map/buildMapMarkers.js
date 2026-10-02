import { datePart } from "@/shared/utils/time";

/**
 * Every located place in the trip, flattened for the map: one marker per
 * stay, per travel endpoint (from and to), and per activity with a place.
 * Pure — no React, no Google Maps — so it's easy to test independently of
 * the map widget itself.
 */

function markerFromLocation(loc, { id, kind, mode, day, title }) {
  if (loc?.lat == null || loc?.lng == null) return null;
  return {
    id,
    kind, // "stay" | "travel" | "activity"
    mode: mode ?? null, // a travel's mode (flight, train, ...); null otherwise
    lat: loc.lat,
    lng: loc.lng,
    title,
    imgRef: loc.imgRef ?? null,
    placeId: loc.placeId ?? null,
    address: loc.address ?? null,
    day, // the trip date this marker belongs to, for "view that day"
  };
}

export function buildMapMarkers(trip) {
  const markers = [];

  for (const stay of trip.stays ?? []) {
    const marker = markerFromLocation(stay.location, {
      id: `stay-${stay.id}`,
      kind: "stay",
      day: datePart(stay.checkIn),
      title: stay.name,
    });
    if (marker) markers.push(marker);
  }

  for (const travel of trip.travels ?? []) {
    const from = markerFromLocation(travel.from, {
      id: `travel-${travel.id}-from`,
      kind: "travel",
      mode: travel.mode,
      day: datePart(travel.depart),
      title: travel.title,
    });
    if (from) markers.push(from);

    const to = markerFromLocation(travel.to, {
      id: `travel-${travel.id}-to`,
      kind: "travel",
      mode: travel.mode,
      day: datePart(travel.arrive ?? travel.depart),
      title: travel.title,
    });
    if (to) markers.push(to);
  }

  for (const day of trip.days ?? []) {
    for (const item of day.items) {
      const marker = markerFromLocation(item.location, {
        id: `item-${item.id}`,
        kind: "activity",
        day: day.date,
        title: item.title,
      });
      if (marker) markers.push(marker);
    }
  }

  return markers;
}
