import { describe, expect, it } from "vitest";
import { percent, placeTime, rainInches, toC, toF, toMph } from "@/features/weather/units";

describe("weather units", () => {
  it("shows °F (and °C) from Celsius", () => {
    expect(toF(0)).toBe(32);
    expect(toF(27.5)).toBe(82);
    expect(toF(-40)).toBe(-40);
    expect(toC(27.5)).toBe(28);
    expect(toF(null)).toBeNull();
  });

  it("shows mph from m/s, inches from mm, % from 0 to 1", () => {
    expect(toMph(5.5)).toBe(12);
    expect(rainInches(2.4)).toBe("0.1 in");
    expect(rainInches(25.4)).toBe("1.0 in");
    expect(rainInches(0.5)).toBe("<0.1 in");
    expect(rainInches(0)).toBeNull();
    expect(percent(0.35)).toBe("35%");
  });

  it("tells sunrise in the place's own zone", () => {
    // 21:12 UTC is 6:12 the next morning in Okinawa.
    expect(placeTime("2026-10-29T21:12:00Z", "Asia/Tokyo")).toMatch(/6:12/);
    expect(placeTime(null, "Asia/Tokyo")).toBeNull();
  });
});
