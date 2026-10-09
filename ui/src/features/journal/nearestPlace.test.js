import { describe, it, expect } from "vitest";
import { accuracyLabel, distanceMetres, locationLabel, nearestPlace } from "@/features/journal/nearestPlace";
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

describe("locationLabel", () => {
  const far = { lat: hotel.lat + 0.01, lng: hotel.lng, accuracy: 12.4 };

  it("prefers a trip place close by, even over a looked-up name", () => {
    const close = { lat: hotel.lat + 0.0004, lng: hotel.lng, placeName: "Café", placeArea: "Bern" };
    expect(locationLabel(TRIP, close)).toBe(`Near ${TRIP.stays[0].name}`);
  });

  it("then the server's place name and area", () => {
    expect(locationLabel(TRIP, { ...far, placeName: "Café Central", placeArea: "Innere Stadt, Vienna" })).toBe(
      "Café Central · Innere Stadt, Vienna"
    );
    expect(locationLabel(TRIP, { ...far, placeName: null, placeArea: "Wieden, Vienna" })).toBe("Wieden, Vienna");
  });

  it("else just that a location is attached", () => {
    expect(locationLabel(TRIP, far)).toBe("Location attached");
  });

  it("says the accuracy separately", () => {
    expect(accuracyLabel(far)).toBe("±12 m");
    expect(accuracyLabel({ lat: 1, lng: 2 })).toBeNull();
  });
});
