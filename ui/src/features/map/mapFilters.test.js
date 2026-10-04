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
  const markers = [stay, activity, travelLeg];

  it("with no filters, keeps everything", () => {
    expect(filterMarkers(markers)).toEqual(markers);
  });

  it("stayOnly keeps only stays, any date", () => {
    expect(filterMarkers(markers, { stayOnly: true })).toEqual([stay]);
  });

  it("a date alone keeps whatever is relevant that day, any kind", () => {
    expect(filterMarkers(markers, { date: "2026-05-12" })).toEqual([stay, activity]);
  });

  it("combines: stays happening on that specific day", () => {
    expect(filterMarkers(markers, { stayOnly: true, date: "2026-05-12" })).toEqual([stay]);
    expect(filterMarkers(markers, { stayOnly: true, date: "2026-05-10" })).toEqual([]);
  });
});

describe("the memories toggle", () => {
  const memory = { id: "memory-1", kind: "memory", day: "2026-05-11" };
  const stay = { id: "stay-1", kind: "stay", day: "2026-05-11", endDay: "2026-05-12" };
  it("hides memory pins when off, and House (stays only) hides them too", () => {
    expect(filterMarkers([memory, stay], { memories: false })).toEqual([stay]);
    expect(filterMarkers([memory, stay], { stayOnly: true })).toEqual([stay]);
    expect(filterMarkers([memory, stay], {})).toEqual([memory, stay]);
  });
  it("Calendar matches a memory by the day it was written", () => {
    expect(filterMarkers([memory], { date: "2026-05-11" })).toEqual([memory]);
    expect(filterMarkers([memory], { date: "2026-05-12" })).toEqual([]);
  });
});
