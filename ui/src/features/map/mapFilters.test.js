import { describe, expect, it } from "vitest";
import { filterMarkers, markerMatchesDate } from "@/features/map/mapFilters";

const stay = { kind: "stay", day: "2026-05-11", endDay: "2026-05-13" };
const activity = { kind: "activity", day: "2026-05-12" };
const travelLeg = { kind: "travel", day: "2026-05-10" };

describe("markerMatchesDate", () => {
  it("matches every marker when there's no date filter", () => {
    expect(markerMatchesDate(stay, null)).toBe(true);
    expect(markerMatchesDate(activity, null)).toBe(true);
  });

  it("matches a stay on any night it covers, not just check-in", () => {
    expect(markerMatchesDate(stay, "2026-05-11")).toBe(true); // check-in night
    expect(markerMatchesDate(stay, "2026-05-12")).toBe(true); // middle night
    expect(markerMatchesDate(stay, "2026-05-13")).toBe(false); // check-out morning, not a night
    expect(markerMatchesDate(stay, "2026-05-10")).toBe(false);
  });

  it("matches a non-stay only on its own day", () => {
    expect(markerMatchesDate(activity, "2026-05-12")).toBe(true);
    expect(markerMatchesDate(activity, "2026-05-11")).toBe(false);
    expect(markerMatchesDate(travelLeg, "2026-05-10")).toBe(true);
  });
});

describe("filterMarkers", () => {
  const memory = { kind: "memory", day: "2026-05-12" };
  const markers = [stay, activity, travelLeg, memory];

  it("by default keeps the trip's places but not memories", () => {
    expect(filterMarkers(markers)).toEqual([stay, activity, travelLeg]);
  });

  it('"stays" keeps only stays, any date', () => {
    expect(filterMarkers(markers, { only: "stays" })).toEqual([stay]);
  });

  it('"memories" keeps only memories', () => {
    expect(filterMarkers(markers, { only: "memories" })).toEqual([memory]);
  });

  it("a date alone keeps the places relevant that day, any kind but memories", () => {
    expect(filterMarkers(markers, { date: "2026-05-12" })).toEqual([stay, activity]);
  });

  it("the date narrows either filter", () => {
    expect(filterMarkers(markers, { only: "stays", date: "2026-05-12" })).toEqual([stay]);
    expect(filterMarkers(markers, { only: "stays", date: "2026-05-10" })).toEqual([]);
    // A memory matches the day it was written.
    expect(filterMarkers(markers, { only: "memories", date: "2026-05-12" })).toEqual([memory]);
    expect(filterMarkers(markers, { only: "memories", date: "2026-05-11" })).toEqual([]);
  });
});
