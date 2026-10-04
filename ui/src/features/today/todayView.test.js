import { describe, it, expect } from "vitest";
import { nextUp, referenceDay, tonight } from "@/features/today/todayView";
import { wallToInstant } from "@/shared/utils/tripDates";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

const TRIP = structuredClone(sampleTrip); // May 10–14, 2026, Europe/Zurich

describe("wallToInstant", () => {
  it("reads a wall clock on its own zone's clock", () => {
    expect(new Date(wallToInstant("2026-05-10T17:40", "America/Chicago")).toISOString()).toBe("2026-05-10T22:40:00.000Z");
    expect(new Date(wallToInstant("2026-05-11T09:25", "Europe/Zurich")).toISOString()).toBe("2026-05-11T07:25:00.000Z");
  });
});

describe("referenceDay", () => {
  it("is today while the trip is under way", () => {
    expect(referenceDay(TRIP, new Date("2026-05-12T10:00:00Z"))).toEqual({ date: "2026-05-12", active: true });
  });

  it("previews the first day otherwise", () => {
    expect(referenceDay(TRIP, new Date("2026-10-03T10:00:00Z"))).toEqual({ date: "2026-05-10", active: false });
  });
});

describe("nextUp", () => {
  it("in the preview, starts from the first day: the outbound flight", () => {
    const ref = referenceDay(TRIP, new Date("2026-10-03T10:00:00Z"));
    const next = nextUp(TRIP, ref);
    expect(next.entry.kind).toBe("travel");
    expect(next.entry.phase).toBe("depart");
    expect(next.date).toBe("2026-05-10");
  });

  it("compares across zones: mid-flight, the next thing is in Zurich, not the landing", () => {
    // 2026-05-11 05:00Z: in the air (landing 07:25Z is an arrival, which is skipped).
    const now = new Date("2026-05-11T05:00:00Z");
    const next = nextUp(TRIP, referenceDay(TRIP, now), now);
    expect(next).not.toBeNull();
    expect(next.instant).toBeGreaterThanOrEqual(now.getTime());
    expect(!(next.entry.kind === "travel" && next.entry.phase === "arrive")).toBe(true);
    expect(next.date >= "2026-05-11").toBe(true);
  });

  it("skips what has already happened", () => {
    const now = new Date("2026-05-10T23:00:00Z"); // after the 17:40 Chicago departure (22:40Z)
    const next = nextUp(TRIP, referenceDay(TRIP, now), now);
    expect(next.entry.key).not.toBe(nextUp(TRIP, { date: "2026-05-10", active: false }).entry.key);
  });

  it("is null when nothing timed is left", () => {
    const now = new Date("2026-05-14T15:00:00Z"); // 17:00 in Zurich, after the 13:05 flight home
    expect(nextUp(TRIP, referenceDay(TRIP, now), now)).toBeNull();
  });
});

describe("tonight", () => {
  it("finds the stay covering a night", () => {
    const night = tonight(TRIP, "2026-05-11");
    expect(night.stay?.name).toBe(TRIP.stays[0].name);
    expect(night.checkingOut).toBeNull();
  });

  it("on a changeover day: tonight's new stay and this morning's check-out", () => {
    const changeover = TRIP.stays[1].checkIn.slice(0, 10);
    const night = tonight(TRIP, changeover);
    expect(night.stay.name).toBe(TRIP.stays[1].name);
    expect(night.checkingOut.name).toBe(TRIP.stays[0].name);
  });

  it("nothing on a night without a stay", () => {
    expect(tonight(TRIP, "2026-05-10")).toEqual({ stay: null, checkingOut: null });
  });
});
