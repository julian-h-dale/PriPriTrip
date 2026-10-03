import { describe, it, expect } from "vitest";
import { normalize, searchTrip } from "@/features/search/tripSearch";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

const TRIP = structuredClone(sampleTrip);
const titles = (groups) => groups.flatMap((g) => g.results.map((r) => r.title));

describe("searchTrip", () => {
  it("finds by title, ignoring case and accents", () => {
    expect(titles(searchTrip(TRIP, "zurich")).some((t) => t.includes("Zürich"))).toBe(true);
    expect(normalize("Zürich Flughafen")).toBe("zurich flughafen");
  });

  it("finds by confirmation number and says where it matched", () => {
    const conf = TRIP.travels[0].confirmationNumber;
    const groups = searchTrip(TRIP, conf.toLowerCase());
    // The round trip's two flights share one booking: both legs match.
    expect(groups.map((g) => g.date)).toEqual(["2026-05-10", "2026-05-14"]);
    expect(groups[0].results[0].where).toBe(`Confirmation: ${conf}`);
  });

  it("finds by carrier + number and by words in the notes", () => {
    expect(titles(searchTrip(TRIP, "LX 9"))).toContain("Chicago → Zürich");
    const sbb = searchTrip(TRIP, "SBB");
    expect(sbb.length).toBeGreaterThan(0);
    expect(sbb[0].results[0].where).toMatch(/^Notes: /);
    expect(sbb[0].results[0].where).not.toContain("**"); // markdown stripped
    // A train's carrier line is labelled as a train, not a flight.
    expect(sbb.flatMap((g) => g.results).find((r) => r.title === "Zürich Airport → Bern").where).toMatch(/^Train: SBB/);
  });

  it("lists a stay once, at its check-in, not on every night", () => {
    const groups = searchTrip(TRIP, TRIP.stays[1].name);
    const hits = groups.flatMap((g) => g.results.filter((r) => r.entry.kind === "stay"));
    expect(hits).toHaveLength(1);
    expect(hits[0].entry.phase).toBe("check-in");
  });

  it("matches a day's own title and summary", () => {
    const day = TRIP.days.find((d) => d.title);
    const groups = searchTrip(TRIP, day.title);
    expect(groups.find((g) => g.date === day.date)?.day).toContain(day.title);
  });

  it("needs every word, and returns nothing for an empty query", () => {
    expect(searchTrip(TRIP, "fondue zzzz")).toEqual([]);
    expect(titles(searchTrip(TRIP, "fondue night"))).toContain("Fondue night");
    expect(searchTrip(TRIP, "   ")).toEqual([]);
  });
});
