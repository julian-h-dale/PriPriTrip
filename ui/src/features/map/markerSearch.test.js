import { describe, expect, it } from "vitest";
import { matchMarkers } from "@/features/map/markerSearch";

const markers = [
  { id: "1", title: "Hotel Goldener Schlüssel", city: "Bern" },
  { id: "2", title: "Beausite Park Hotel", city: "Wengen" },
  { id: "3", title: "Zürich Airport (ZRH)", city: null },
];

describe("matchMarkers", () => {
  it("matches by title, case-insensitively", () => {
    expect(matchMarkers(markers, "beausite")).toEqual([markers[1]]);
  });

  it("matches by city too", () => {
    expect(matchMarkers(markers, "bern")).toEqual([markers[0]]);
  });

  it("is empty for an empty query", () => {
    expect(matchMarkers(markers, "  ")).toEqual([]);
  });

  it("is empty when nothing matches, without erroring on a marker with no city", () => {
    expect(matchMarkers(markers, "nowhere")).toEqual([]);
  });
});
