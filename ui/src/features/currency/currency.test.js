import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { money, parseAmount, referenceAmount } from "@/features/currency/money";
import { MAX_AGE_MS, fetchRates, isFresh, storedRates } from "@/features/currency/rates";
import { currencyOn, tripCurrencies } from "@/features/currency/tripCurrencies";

export const OKINAWA = {
  id: "trip-1",
  name: "Okinawa & Taipei",
  startDate: "2026-10-29",
  endDate: "2026-11-13",
  timezone: "Asia/Tokyo",
  stays: [
    { name: "Palm Royal", checkIn: "2026-10-30T15:00", checkOut: "2026-11-02T11:00", zone: "Asia/Tokyo" },
    { name: "Taipei hotel", checkIn: "2026-11-09T15:00", checkOut: "2026-11-13T11:00", zone: "Asia/Taipei" },
  ],
  travels: [
    { title: "To Taipei", depart: "2026-10-29T00:30", arrive: "2026-10-30T05:00", departZone: "America/Chicago", arriveZone: "Asia/Taipei" },
    { title: "Home", depart: "2026-11-13T17:00", arrive: "2026-11-13T19:00", departZone: "Asia/Taipei", arriveZone: "America/Chicago" },
  ],
  days: [],
};

describe("a trip's currencies", () => {
  it("come from its places, in itinerary order, without USD", () => {
    expect(tripCurrencies(OKINAWA)).toEqual(["TWD", "JPY"]); // lands in Taipei first, then Okinawa
    expect(tripCurrencies({ ...OKINAWA, travels: [] })).toEqual(["JPY", "TWD"]);
  });

  it("fall back to the trip's own zone, and a US trip has none", () => {
    expect(tripCurrencies({ ...OKINAWA, stays: [], travels: [] })).toEqual(["JPY"]);
    expect(tripCurrencies({ ...OKINAWA, timezone: "America/Chicago", stays: [], travels: [] })).toEqual([]);
  });

  it("knows where you sleep on a given night", () => {
    expect(currencyOn(OKINAWA, "2026-10-31")).toBe("JPY");
    expect(currencyOn(OKINAWA, "2026-11-10")).toBe("TWD");
    expect(currencyOn(OKINAWA, "2026-11-05")).toBeNull();
  });
});

describe("money", () => {
  it("parses what a phone keyboard types", () => {
    expect(parseAmount("1000")).toBe(1000);
    expect(parseAmount("1,234.5")).toBe(1234.5);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount(" ")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
  });

  it("picks a round reference amount for the rate", () => {
    expect(referenceAmount(157.93)).toBe(100);
    expect(referenceAmount(31.82)).toBe(100);
    expect(referenceAmount(0.92)).toBe(1);
    expect(referenceAmount(1450)).toBe(1000);
  });

  it("formats in the currency's own style", () => {
    expect(money(6.332, "USD")).toMatch(/6\.33/);
    expect(money(1000, "JPY")).toMatch(/1,000/);
    expect(money(1000, "JPY")).not.toMatch(/\./);
  });
});

describe("rates on the device", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("fetches USD rates and keeps them with when they were fetched", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        { date: "2026-10-05", base: "USD", quote: "JPY", rate: 157.93 },
        { date: "2026-10-05", base: "USD", quote: "TWD", rate: 31.821 },
      ],
    });
    await fetchRates(["JPY", "TWD"]);
    expect(fetch).toHaveBeenCalledWith("https://api.frankfurter.dev/v2/rates?base=USD&quotes=JPY,TWD");
    const stored = storedRates();
    expect(stored.rates.JPY).toEqual({ rate: 157.93, date: "2026-10-05" });
    expect(isFresh(stored, ["JPY", "TWD"])).toBe(true);
    expect(isFresh(stored, ["JPY", "EUR"])).toBe(false); // EUR isn't stored
    expect(isFresh(stored, ["JPY"], Date.now() + MAX_AGE_MS + 1000)).toBe(false);
  });

  it("a failed fetch throws and leaves the stored rates alone", async () => {
    localStorage.setItem("fx:USD", JSON.stringify({ fetchedAt: "2026-10-01T00:00:00Z", rates: { JPY: { rate: 150, date: "2026-10-01" } } }));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchRates(["JPY"])).rejects.toThrow();
    expect(storedRates().rates.JPY.rate).toBe(150);
  });
});
