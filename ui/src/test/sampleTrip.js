import sampleTrip from "../../../api/app/sample_data/sample_trip.json";

// The sample trip as the API reads it: ids, zones, a duration.
export const TRIP = (() => {
  const t = { ...structuredClone(sampleTrip), id: "trip-1", role: "owner", createdAt: "2026-10-02T05:00:00Z" };
  t.stays = t.stays.map((s, i) => ({ ...s, id: `stay-${i}`, zone: "Europe/Zurich", version: 1 }));
  t.travels = t.travels.map((x, i) => ({ ...x, id: `travel-${i}`, version: 1 }));
  t.travels[0] = { ...t.travels[0], departZone: "America/Chicago", arriveZone: "Europe/Zurich", durationMinutes: 525 };
  const read = (prefix) => (it, i) => ({ ...it, id: `${prefix}-${i}`, zone: "Europe/Zurich", version: 1 });
  t.days = t.days.map((d) => ({ ...d, items: d.items.map(read(d.date)), planB: (d.planB ?? []).map(read(`${d.date}-b`)) }));
  return t;
})();
