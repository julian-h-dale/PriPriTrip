import { describe, it, expect } from "vitest";
import { distanceMetres, nearestPlace } from "@/features/journal/nearestPlace";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

const TRIP = structuredClone(sampleTrip);
const hotel = TRIP.stays[0].location; // Hotel Goldener Schlüssel, Bern

describe("nearestPlace", () => {
  it("names the trip place a memory was written near", () => {
    const fewMetresAway = { lat: hotel.lat + 0.0004, lng: hotel.lng }; // ~45 m north
    expect(nearestPlace(TRIP, fewMetresAway)).toMatchObject({ title: TRIP.stays[0].name });
  });

  it("is nothing when no trip place is within 250 m", () => {
    expect(nearestPlace(TRIP, { lat: hotel.lat + 0.01, lng: hotel.lng })).toBeNull(); // ~1.1 km
    expect(nearestPlace(TRIP, null)).toBeNull();
  });

  it("measures real distances", () => {
    // Bern to Zürich is about 95 km as the crow flies.
    const km = distanceMetres({ lat: 46.948, lng: 7.4474 }, { lat: 47.3769, lng: 8.5417 }) / 1000;
    expect(km).toBeGreaterThan(90);
    expect(km).toBeLessThan(100);
  });
});
