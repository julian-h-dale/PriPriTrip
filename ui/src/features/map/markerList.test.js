import { describe, expect, it } from "vitest";
import { buildMapMarkers } from "@/features/map/buildMapMarkers";
import { groupMarkers, markerSubtitle } from "@/features/map/markerList";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

function readTrip() {
  const trip = structuredClone(sampleTrip);
  trip.stays.forEach((s, i) => (s.id = `stay-${i}`));
  trip.travels.forEach((t, i) => (t.id = `travel-${i}`));
  trip.days.forEach((day, d) => day.items.forEach((item, i) => (item.id = `item-${d}-${i}`)));
  trip.pointsOfInterest = [
    { id: "p2", name: "Zytglogge clock shop", category: "shop", location: { name: "Zytglogge shop", lat: 46.948, lng: 7.448 } },
    { id: "p1", name: "Bundesplatz market", category: "market", location: { name: "Bundesplatz", address: "Bundesplatz, 3011 Bern", lat: 46.946, lng: 7.444 } },
  ];
  return trip;
}

describe("the map's List", () => {
  const markers = buildMapMarkers(readTrip());

  it("groups by kind, in a fixed order, only kinds that are there", () => {
    expect(groupMarkers(markers).map((g) => g.label)).toEqual(["Stays", "Activities", "Travel", "Points of interest"]);
    const memory = { kind: "memory", id: "memory-1", title: "Fondue", day: "2026-05-11", time: "7:00 PM" };
    expect(groupMarkers([memory]).map((g) => g.label)).toEqual(["Journal"]);
    expect(groupMarkers([])).toEqual([]);
  });

  it("each group in trip order by day; points of interest A–Z", () => {
    const groups = Object.fromEntries(groupMarkers(markers).map((g) => [g.kind, g.markers]));
    const days = groups.activity.map((m) => m.day);
    expect(days).toEqual([...days].sort());
    expect(groups.activity[0].title).toBe(sampleTrip.days[0].items.find((i) => i.location?.lat != null).title);
    expect(groups.poi.map((m) => m.title)).toEqual(["Bundesplatz market", "Zytglogge clock shop"]);
  });

  it("says where each one is: a leg's end, an address, a memory's when", () => {
    const flight = markers.filter((m) => m.kind === "travel" && m.title === "Chicago → Zürich");
    expect(flight.map(markerSubtitle)).toEqual(["From Chicago O'Hare (ORD)", "To Zürich Airport (ZRH)"]);
    expect(markerSubtitle(markers.find((m) => m.id === "poi-p1"))).toBe("Bundesplatz, 3011 Bern");
    // No address: the place's own name, when it isn't the title.
    expect(markerSubtitle(markers.find((m) => m.id === "poi-p2"))).toBe("Zytglogge shop");
    expect(markerSubtitle({ kind: "memory", day: "2026-05-11", time: "7:00 PM" })).toBe("Mon, May 11 · 7:00 PM");
  });
});
