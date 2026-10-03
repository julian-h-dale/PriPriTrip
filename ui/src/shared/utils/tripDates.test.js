import { describe, it, expect } from "vitest";
import { isInTrip, todayIn, tripPhase } from "@/shared/utils/tripDates";

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
