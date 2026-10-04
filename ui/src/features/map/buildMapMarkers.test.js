import { describe, expect, it } from "vitest";
import { buildMapMarkers } from "@/features/map/buildMapMarkers";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

/** The sample trip in the API's read shape: ids on every record. */
function readTrip() {
  const trip = structuredClone(sampleTrip);
  trip.id = "trip-1";
  trip.stays.forEach((s, i) => (s.id = `stay-${i}`));
  trip.travels.forEach((t, i) => (t.id = `travel-${i}`));
  trip.days.forEach((day, d) => day.items.forEach((item, i) => (item.id = `item-${d}-${i}`)));
  return trip;
}

describe("buildMapMarkers", () => {
  const markers = buildMapMarkers(readTrip());
  const byId = (id) => markers.find((m) => m.id === id);

  it("includes every stay with coordinates, on its check-in date", () => {
    expect(byId("stay-stay-0")).toMatchObject({
      kind: "stay",
      title: "Hotel Goldener Schlüssel",
      day: "2026-05-11",
    });
    expect(byId("stay-stay-1")).toMatchObject({
      kind: "stay",
      title: "Beausite Park Hotel",
      day: "2026-05-12",
    });
  });

  it("includes a located travel leg's from and to, each on its own date", () => {
    expect(byId("travel-travel-0-from")).toMatchObject({
      kind: "travel",
      mode: "flight",
      title: "Chicago → Zürich",
      day: "2026-05-10",
    });
    expect(byId("travel-travel-0-to")).toMatchObject({
      kind: "travel",
      mode: "flight",
      day: "2026-05-11", // the overnight arrival date, not the depart date
    });
  });

  it("skips a travel leg with no coordinates on either end", () => {
    // "Zürich Airport -> Bern" (travel-1) and "Bern -> Wengen" (travel-2) are
    // named places only, no lat/lng in the sample.
    expect(byId("travel-travel-1-from")).toBeUndefined();
    expect(byId("travel-travel-1-to")).toBeUndefined();
    expect(byId("travel-travel-2-from")).toBeUndefined();
    expect(byId("travel-travel-2-to")).toBeUndefined();
  });

  it("includes an activity's place, on its day, and skips one with no place", () => {
    expect(byId("item-item-0-0")).toMatchObject({
      kind: "activity",
      title: "Lunch at Altes Tramdepot",
      day: "2026-05-11",
    });
    // "Old Town & Zytglogge walk" has no location.
    expect(byId("item-item-0-1")).toBeUndefined();
  });

  it("carries the photo and place id through when the location has them", () => {
    const kornhauskeller = byId("item-item-0-2");
    expect(kornhauskeller.placeId).toBeNull(); // sample has none
    expect(kornhauskeller.address).toBe("Kornhausplatz 18, 3011 Bern, Switzerland");
  });
});
