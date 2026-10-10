import { describe, it, expect } from "vitest";
import { milesLabel, nearbyPointsOfInterest, NEARBY_METRES } from "@/features/pointsOfInterest/nearby";

// Beitou: the Hot Spring Museum, with Thermal Valley and Millennium Hot
// Spring a few hundred metres away, and Taipei 101 well outside half a mile.
const MUSEUM = { name: "Beitou Hot Spring Museum", lat: 25.1365694, lng: 121.50715, placeId: "museum" };
const poi = (id, name, lat, lng, extra = {}) => ({ id, name, category: "sight", location: { name, lat, lng, ...extra } });
const VALLEY = poi("valley", "Thermal Valley", 25.1377, 121.5113);
const SPRING = poi("spring", "Millennium Hot Spring", 25.1369, 121.5079);
const TAIPEI_101 = poi("101", "Taipei 101", 25.0339, 121.5645);
const TRIP = { pointsOfInterest: [TAIPEI_101, VALLEY, SPRING] };

describe("nearbyPointsOfInterest", () => {
  it("keeps those within half a mile, closest first", () => {
    const near = nearbyPointsOfInterest(TRIP, MUSEUM);
    expect(near.map(({ poi }) => poi.id)).toEqual(["spring", "valley"]);
    expect(near[0].metres).toBeLessThan(near[1].metres);
    expect(near[1].metres).toBeLessThan(NEARBY_METRES);
  });

  it("leaves out the entry's own place", () => {
    const itself = poi("museum-poi", "Hot Spring Museum", MUSEUM.lat, MUSEUM.lng, { placeId: "museum" });
    const near = nearbyPointsOfInterest({ pointsOfInterest: [itself, SPRING] }, MUSEUM);
    expect(near.map(({ poi }) => poi.id)).toEqual(["spring"]);
  });

  it("is empty without coordinates, or without points of interest", () => {
    expect(nearbyPointsOfInterest(TRIP, { name: "Somewhere" })).toEqual([]);
    expect(nearbyPointsOfInterest(TRIP, null)).toEqual([]);
    expect(nearbyPointsOfInterest({}, MUSEUM)).toEqual([]);
  });
});

describe("milesLabel", () => {
  it("one decimal, and <0.1 mi for anything closer", () => {
    expect(milesLabel(483)).toBe("0.3 mi");
    expect(milesLabel(805)).toBe("0.5 mi");
    expect(milesLabel(40)).toBe("<0.1 mi");
  });
});
