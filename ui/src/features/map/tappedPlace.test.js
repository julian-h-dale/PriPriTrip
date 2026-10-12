import { describe, it, expect } from "vitest";
import { markerForPlace } from "@/features/map/tappedPlace";

const outbound = { id: "travel-0:to", placeId: "zrh" };
const homeward = { id: "travel-1:from", placeId: "zrh" };
const hotel = { id: "stay-0", placeId: "hotel" };
const memory = { id: "mem-1", placeId: null };

describe("markerForPlace", () => {
  const markers = [outbound, homeward, hotel, memory];

  it("finds the trip marker with the tapped place id", () => {
    expect(markerForPlace(markers, markers, "hotel")).toBe(hotel);
  });

  it("prefers a marker the map is showing over one the filters hide", () => {
    expect(markerForPlace(markers, [homeward, hotel], "zrh")).toBe(homeward);
    expect(markerForPlace(markers, [hotel], "zrh")).toBe(outbound);
  });

  it("is null for a place not on the trip, or no place id", () => {
    expect(markerForPlace(markers, markers, "cafe")).toBeNull();
    expect(markerForPlace(markers, markers, null)).toBeNull();
    expect(markerForPlace(markers, markers, undefined)).toBeNull();
  });
});
