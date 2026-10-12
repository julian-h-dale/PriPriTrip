import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  DEFAULT_RADIUS,
  distanceLabel,
  distanceUnit,
  nearbyRadius,
  openOn,
  setDistanceUnit,
  setNearbyRadius,
  setOpenOn,
  useNearbyRadius,
} from "@/shared/phoneSettings";

const MILE = 1609.344;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("distances (Run stage 29)", () => {
  it("miles unless this phone chose kilometres", () => {
    expect(distanceUnit()).toBe("mi");
    setDistanceUnit("km");
    expect(distanceUnit()).toBe("km");
    setDistanceUnit("mi");
    expect(localStorage.getItem("distanceUnit")).toBeNull();
  });

  it("labels in either unit", () => {
    expect(distanceLabel(483, "mi")).toBe("0.3 mi");
    expect(distanceLabel(805, "mi")).toBe("0.5 mi");
    expect(distanceLabel(40, "mi")).toBe("<0.1 mi");
    expect(distanceLabel(447, "km")).toBe("450 m");
    expect(distanceLabel(4, "km")).toBe("<10 m");
    expect(distanceLabel(1234, "km")).toBe("1.2 km");
  });
});

describe("opens on", () => {
  it("per trip, null until chosen, and only the three choices", () => {
    expect(openOn("a")).toBeNull();
    setOpenOn("a", "map");
    expect(openOn("a")).toBe("map");
    expect(openOn("b")).toBeNull();
    localStorage.setItem("openOn", JSON.stringify({ a: "journal" }));
    expect(openOn("a")).toBeNull();
    localStorage.setItem("openOn", "not json");
    expect(openOn("a")).toBeNull();
  });
});

describe("the nearby radius", () => {
  it("½ mi by default, per trip", () => {
    expect(nearbyRadius("a", "mi")).toEqual({ metres: MILE / 2, label: "½ mi" });
    setNearbyRadius("a", MILE);
    expect(nearbyRadius("a", "mi").label).toBe("1 mi");
    expect(nearbyRadius("b", "mi").label).toBe("½ mi");
  });

  it("switching units moves to the nearest step", () => {
    expect(nearbyRadius("a", "km").label).toBe("1 km"); // ½ mi ≈ 0.8 km
    setNearbyRadius("a", MILE / 4);
    expect(nearbyRadius("a", "km").label).toBe("0.5 km");
    setNearbyRadius("a", 3000);
    expect(nearbyRadius("a", "mi").label).toBe("2 mi");
  });

  it("anything that isn't a step reads as the default", () => {
    localStorage.setItem("nearbyRadius", JSON.stringify({ a: 1234 }));
    expect(nearbyRadius("a", "mi").metres).toBe(DEFAULT_RADIUS);
    localStorage.setItem("nearbyRadius", "{oops");
    expect(nearbyRadius("a", "mi").metres).toBe(DEFAULT_RADIUS);
  });

  it("re-renders when it changes, and lasts the session when storage throws", () => {
    const { result } = renderHook(() => useNearbyRadius("a"));
    expect(result.current.label).toBe("½ mi");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    act(() => setNearbyRadius("a", MILE * 2));
    expect(result.current.label).toBe("2 mi");
  });
});
