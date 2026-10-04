import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { cityOf, dayCities } from "@/features/timeline/dayCities";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

describe("cityOf", () => {
  it("prefers the city Google gave", () => {
    expect(cityOf({ name: "ZRH", city: "Kloten", address: "8058 Zürich, Switzerland" })).toBe("Kloten");
  });

  it("guesses from an address", () => {
    expect(cityOf({ name: "x", address: "Rathausgasse 72, 3011 Bern, Switzerland" })).toBe("Bern");
    expect(cityOf({ name: "x", address: "Bern, Switzerland" })).toBe("Bern");
    expect(cityOf({ name: "x", address: "10 Downing St, London SW1A 2AA, UK" })).toBe("London");
    expect(cityOf({ name: "x", address: "1 Main St, Springfield, IL 62704, USA" })).toBe("Springfield");
  });

  it("says nothing when there is nothing to judge by", () => {
    expect(cityOf(null)).toBeNull();
    expect(cityOf({ name: "Bern" })).toBeNull();
    expect(cityOf({ name: "x", address: "Switzerland" })).toBeNull();
  });
});

describe("dayCities", () => {
  const rows = buildTimeline(sampleTrip);
  const cities = (date) => dayCities(rows.find((r) => r.date === date));

  it("follows the day's places in timeline order, merging repeats", () => {
    expect(cities("2026-05-10")).toEqual(["Chicago", "Zürich"]);
    // Overnight arrival, train, then a day in Bern.
    expect(cities("2026-05-11")).toEqual(["Zürich", "Bern"]);
    expect(cities("2026-05-12")).toEqual(["Bern", "Wengen"]);
    expect(cities("2026-05-14")).toEqual(["Wengen", "Zürich", "Chicago"]);
  });

  it("is empty for a day without places", () => {
    expect(dayCities({ date: "2026-05-20", entries: [] })).toEqual([]);
  });
});
