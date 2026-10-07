import { describe, expect, it } from "vitest";
import { filterMarkers, markerMatchesDate, viewFor } from "@/features/map/mapFilters";

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

describe("a travel leg on the day filter", () => {
  const overnight = { kind: "travel", day: "2026-05-10", legDays: ["2026-05-10", "2026-05-11"] };
  it("matches both ends on every day it travels", () => {
    expect(markerMatchesDate(overnight, "2026-05-10")).toBe(true);
    expect(markerMatchesDate(overnight, "2026-05-11")).toBe(true);
    expect(markerMatchesDate(overnight, "2026-05-12")).toBe(false);
  });
});

describe("viewFor", () => {
  const at = (kind, lat, lng, extra = {}) => ({ kind, lat, lng, day: "2026-05-11", ...extra });
  const hotel = at("stay", 46.95, 7.44, { endDay: "2026-05-13" });
  const museum = at("activity", 46.94, 7.45);
  const chicago = at("travel", 41.97, -87.9, { day: "2026-05-10" });
  const zurich = at("travel", 47.45, 8.55, { day: "2026-05-10" });
  const memory = at("memory", 46.96, 7.46);
  const all = [hotel, museum, chicago, zurich, memory];

  it("with no filter, fits the trip's places, not travel", () => {
    expect(viewFor(all)).toEqual({
      kind: "bounds",
      points: [
        { lat: 46.95, lng: 7.44 },
        { lat: 46.94, lng: 7.45 },
      ],
    });
  });

  it("falls back to travel when that's all there is", () => {
    expect(viewFor([chicago, zurich]).points).toHaveLength(2);
  });

  it("with a day, counts that day's travel, across countries", () => {
    expect(viewFor(all, { date: "2026-05-10" })).toEqual({
      kind: "bounds",
      points: [
        { lat: 41.97, lng: -87.9 },
        { lat: 47.45, lng: 8.55 },
      ],
    });
  });

  it("centres on a single place, including one place twice", () => {
    expect(viewFor(all, { only: "memories" })).toEqual({ kind: "point", point: { lat: 46.96, lng: 7.46 } });
    expect(viewFor([hotel, { ...hotel, kind: "activity" }])).toEqual({ kind: "point", point: { lat: 46.95, lng: 7.44 } });
  });

  it("follows the 'what' filter", () => {
    expect(viewFor(all, { only: "stays" })).toEqual({ kind: "point", point: { lat: 46.95, lng: 7.44 } });
  });

  it("is nothing when the filters leave nothing", () => {
    expect(viewFor(all, { date: "2026-06-01" })).toBeNull();
    expect(viewFor([])).toBeNull();
  });
});
