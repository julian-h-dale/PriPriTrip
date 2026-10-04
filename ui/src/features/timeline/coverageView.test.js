import { describe, expect, it } from "vitest";
import { stayCoverage, travelCoverage } from "@/features/timeline/coverageView";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

describe("stayCoverage", () => {
  const coverage = stayCoverage(sampleTrip);

  it("covers the night of check-in through the night before check-out", () => {
    expect(coverage.get("2026-05-11")).toMatchObject({ label: "Hotel Goldener Schlüssel" });
    expect(coverage.get("2026-05-12")).toMatchObject({ label: "Beausite Park Hotel" });
    expect(coverage.get("2026-05-13")).toMatchObject({ label: "Beausite Park Hotel" });
  });

  it("carries the actual stay record, so it can be opened for editing", () => {
    expect(coverage.get("2026-05-11").stay).toBe(sampleTrip.stays[0]);
    expect(coverage.get("2026-05-13").stay).toBe(sampleTrip.stays[1]);
  });

  it("gives each stay its own color, and leaves uncovered dates out", () => {
    expect(coverage.get("2026-05-11").colorClass).not.toBe(coverage.get("2026-05-12").colorClass);
    expect(coverage.has("2026-05-10")).toBe(false); // flying overnight, no stay yet
    expect(coverage.has("2026-05-14")).toBe(false); // check-out morning, not a covered night
  });
});

describe("travelCoverage", () => {
  const coverage = travelCoverage(sampleTrip);

  it("lands on the depart date, and the arrival date too when it's later", () => {
    expect(coverage.get("2026-05-10")).toMatchObject({ label: "Chicago → Zürich" });
    expect(coverage.get("2026-05-14")).toMatchObject({ label: "Zürich → Chicago" });
  });

  it("joins same-day legs into one label, keeping the first leg's color", () => {
    // The overnight flight arrives May 11, and the Zürich -> Bern train also
    // departs May 11: both land on the same date.
    const may11 = coverage.get("2026-05-11");
    expect(may11.label).toBe("Chicago → Zürich · Zürich Airport → Bern");
    expect(may11.colorClass).toBe(coverage.get("2026-05-10").colorClass);
    expect(may11.travels).toEqual([sampleTrip.travels[0], sampleTrip.travels[1]]);
  });

  it("carries a single travel record when only one leg touches the date", () => {
    expect(coverage.get("2026-05-10").travels).toEqual([sampleTrip.travels[0]]);
  });
});
