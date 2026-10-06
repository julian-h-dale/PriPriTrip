import { describe, expect, it } from "vitest";
import { describeEntry } from "@/features/timeline/describeEntry";

const trip = { timezone: "America/Chicago" };
const flight = {
  title: "Chicago → Tokyo",
  mode: "flight",
  carrier: "ANA",
  number: "NH 11",
  depart: "2026-10-29T00:30",
  arrive: "2026-10-30T04:05",
  departZone: "America/Chicago",
  arriveZone: "Asia/Tokyo",
  durationMinutes: 815,
};
const leg = (travel, phase = "depart", overnight = false) => ({ kind: "travel", phase, travel, overnight });

describe("a travel leg's duration", () => {
  it("shows on the departure row and in the details", () => {
    const d = describeEntry(leg(flight, "depart", true), trip);
    expect(d.subtitle).toMatch(/· 13h 35m$/);
    expect(d.facts).toContainEqual(["Duration", "13h 35m"]);
  });

  it("isn't repeated on the arrival row", () => {
    expect(describeEntry(leg(flight, "arrive", true), trip).subtitle).not.toContain("13h");
  });

  it("is left out without an arrival", () => {
    const d = describeEntry(leg({ ...flight, arrive: null, durationMinutes: null }), trip);
    expect(d.subtitle).not.toMatch(/\dh/);
    expect(d.facts.map(([label]) => label)).not.toContain("Duration");
  });
});
