import { afterEach, describe, expect, it } from "vitest";
import { countdownLabel, startOfDay } from "@/features/trips/countdown";

const start = "2026-10-29";
const at = (ms) => startOfDay(start) - ms;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("countdownLabel", () => {
  it("shows one unit at a time, rounded down", () => {
    expect(countdownLabel(start, at(24 * DAY + 5 * HOUR))).toBe("24 days to go");
    expect(countdownLabel(start, at(2 * DAY + 23 * HOUR))).toBe("2 days to go");
    expect(countdownLabel(start, at(47 * HOUR))).toBe("1 day to go");
    expect(countdownLabel(start, at(DAY))).toBe("1 day to go"); // exactly 24 hours
    expect(countdownLabel(start, at(DAY - MIN))).toBe("23 hours to go");
    expect(countdownLabel(start, at(HOUR))).toBe("1 hour to go"); // exactly 60 minutes
    expect(countdownLabel(start, at(59 * MIN))).toBe("59 minutes to go");
    expect(countdownLabel(start, at(MIN))).toBe("1 minute to go");
    expect(countdownLabel(start, at(59_000))).toBe("Starting now");
  });

  it("is gone once the first day has begun", () => {
    expect(countdownLabel(start, at(0))).toBeNull();
    expect(countdownLabel(start, at(-HOUR))).toBeNull();
  });

  it("counts to midnight on the phone's clock", () => {
    const local = new Date(startOfDay(start));
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours()]).toEqual([2026, 9, 29, 0]);
  });
});

describe("across a daylight-saving change (Chicago, Nov 1 2026)", () => {
  const saved = process.env.TZ;
  afterEach(() => {
    process.env.TZ = saved;
  });

  it("still counts whole days to local midnight", () => {
    process.env.TZ = "America/Chicago";
    // Noon on Oct 31 to midnight starting Nov 3: 2 days 12 hours, plus the
    // hour clocks go back on Nov 1 -> still "2 days".
    const noon = new Date(2026, 9, 31, 12).getTime();
    expect(countdownLabel("2026-11-03", noon)).toBe("2 days to go");
    expect(new Date(startOfDay("2026-11-03")).getHours()).toBe(0);
  });
});
