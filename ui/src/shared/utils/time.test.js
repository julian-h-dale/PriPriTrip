import { afterEach, describe, expect, it } from "vitest";
import {
  addDays,
  formatDuration,
  datesInRange,
  daysBetween,
  formatDateRange,
  formatDayHeading,
  formatTime,
  zoneLabel,
} from "@/shared/utils/time";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("time helpers", () => {
  it("formats wall-clock times verbatim", () => {
    expect(formatTime("2026-05-11T14:00")).toBe("2:00 PM");
    expect(formatTime("2026-05-11T00:05")).toBe("12:05 AM");
    expect(formatTime("2026-05-11T12:30:15")).toBe("12:30 PM");
  });

  it("does not depend on the viewer's timezone", () => {
    const render = () => [
      formatTime("2026-05-11T09:25"),
      formatDayHeading("2026-05-11"),
      addDays("2026-03-28", 2), // across a DST change in Europe
      datesInRange("2026-10-31", "2026-11-02").join(","),
    ];
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    const east = render();
    process.env.TZ = "Pacific/Pago_Pago"; // UTC-11
    const west = render();
    expect(east).toEqual(west);
    expect(east).toEqual([
      "9:25 AM",
      "Mon, May 11",
      "2026-03-30",
      "2026-10-31,2026-11-01,2026-11-02",
    ]);
  });

  it("does plain-date arithmetic", () => {
    expect(addDays("2026-05-31", 1)).toBe("2026-06-01");
    expect(daysBetween("2026-05-10", "2026-05-14")).toBe(4);
    expect(datesInRange("2026-05-10", "2026-05-12")).toEqual([
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
    ]);
  });

  it("formats date ranges compactly", () => {
    expect(formatDateRange("2026-05-10", "2026-05-14")).toBe("May 10 – 14, 2026");
    expect(formatDateRange("2026-04-30", "2026-05-02")).toBe("Apr 30 – May 2, 2026");
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("Dec 30, 2026 – Jan 2, 2027");
    expect(formatDateRange("2026-05-10", "2026-05-10")).toBe("May 10, 2026");
  });

  it("labels zones by city", () => {
    expect(zoneLabel("America/Chicago")).toBe("Chicago");
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
});

describe("formatDuration", () => {
  it("shows hours and minutes, and days only past 24 hours", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(125)).toBe("2h 5m");
    expect(formatDuration(830)).toBe("13h 50m");
    expect(formatDuration(1440)).toBe("1d");
    expect(formatDuration(1560)).toBe("1d 2h");
  });

  it("is nothing when unknown", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
  });
});
