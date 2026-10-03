import { describe, it, expect } from "vitest";
import { defaultFormDate, groupTrips, isInTrip, pickLandingTrip, todayIn, tripPhase } from "@/shared/utils/tripDates";

const TRIP = { startDate: "2026-10-29", endDate: "2026-11-13", timezone: "Asia/Tokyo" };

describe("todayIn", () => {
  it("is the calendar day in the named zone, not UTC", () => {
    // 20:00 UTC on Oct 28 is already Oct 29 in Tokyo (UTC+9), still Oct 28 in Chicago.
    const now = new Date("2026-10-28T20:00:00Z");
    expect(todayIn("Asia/Tokyo", now)).toBe("2026-10-29");
    expect(todayIn("America/Chicago", now)).toBe("2026-10-28");
  });
});

describe("isInTrip", () => {
  it("includes both ends and nothing outside", () => {
    expect(isInTrip(TRIP, "2026-10-29")).toBe(true);
    expect(isInTrip(TRIP, "2026-11-13")).toBe(true);
    expect(isInTrip(TRIP, "2026-10-28")).toBe(false);
    expect(isInTrip(TRIP, "2026-11-14")).toBe(false);
    expect(isInTrip(TRIP, "")).toBe(false);
  });
});

describe("tripPhase", () => {
  it("judges upcoming, active and past by the trip's own calendar", () => {
    expect(tripPhase(TRIP, new Date("2026-10-03T12:00:00Z"))).toBe("upcoming");
    // Oct 28 in Chicago, but Oct 29 in Tokyo: the trip has started.
    expect(tripPhase(TRIP, new Date("2026-10-28T20:00:00Z"))).toBe("active");
    expect(tripPhase(TRIP, new Date("2026-11-13T14:00:00Z"))).toBe("active"); // 23:00 Tokyo
    expect(tripPhase(TRIP, new Date("2026-11-13T15:00:00Z"))).toBe("past"); // midnight Tokyo
  });
});

describe("defaultFormDate", () => {
  const BEFORE = new Date("2026-10-03T12:00:00Z"); // trip hasn't started
  const DURING = new Date("2026-11-02T03:00:00Z"); // Nov 2 in Tokyo

  it("uses the preferred date when it's inside the trip", () => {
    expect(defaultFormDate(TRIP, { preferred: "2026-11-05", now: DURING })).toBe("2026-11-05");
  });

  it("ignores a preferred date outside the trip", () => {
    expect(defaultFormDate(TRIP, { preferred: "2026-12-01", now: BEFORE })).toBe("2026-10-29");
  });

  it("uses today, on the trip's calendar, while the trip is under way", () => {
    expect(defaultFormDate(TRIP, { now: DURING })).toBe("2026-11-02");
  });

  it("before the trip: the first date `skip` allows (a stay's first uncovered night)", () => {
    const covered = new Set(["2026-10-29", "2026-10-30"]);
    expect(defaultFormDate(TRIP, { skip: (d) => covered.has(d), now: BEFORE })).toBe("2026-10-31");
  });

  it("falls back to the first day", () => {
    expect(defaultFormDate(TRIP, { now: BEFORE })).toBe("2026-10-29");
    expect(defaultFormDate(TRIP, { skip: () => true, now: BEFORE })).toBe("2026-10-29");
  });
});

describe("groupTrips and pickLandingTrip", () => {
  const NOW = new Date("2026-10-03T12:00:00Z");
  const past1 = { id: "p1", startDate: "2026-05-10", endDate: "2026-05-14", timezone: "Europe/Zurich" };
  const past2 = { id: "p2", startDate: "2026-07-01", endDate: "2026-07-04", timezone: "UTC" };
  const active = { id: "a", startDate: "2026-10-01", endDate: "2026-10-05", timezone: "UTC" };
  const soon = { id: "u1", startDate: "2026-10-29", endDate: "2026-11-13", timezone: "Asia/Tokyo" };
  const later = { id: "u2", startDate: "2027-03-01", endDate: "2027-03-05", timezone: "UTC" };

  it("groups by phase: upcoming soonest first, past most recent first", () => {
    const groups = groupTrips([later, past1, soon, active, past2], NOW);
    expect(groups.active.map((t) => t.id)).toEqual(["a"]);
    expect(groups.upcoming.map((t) => t.id)).toEqual(["u1", "u2"]);
    expect(groups.past.map((t) => t.id)).toEqual(["p2", "p1"]);
  });

  it("lands on the active trip, else the next upcoming, else nothing", () => {
    expect(pickLandingTrip([later, soon, active, past1], NOW).id).toBe("a");
    expect(pickLandingTrip([later, soon, past1], NOW).id).toBe("u1");
    expect(pickLandingTrip([past1, past2], NOW)).toBeNull();
    expect(pickLandingTrip([], NOW)).toBeNull();
  });
});
