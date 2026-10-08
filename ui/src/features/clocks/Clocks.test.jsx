import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { ClocksPage } from "@/features/clocks/ClocksPage";
import { compareToPhone, formatUtcOffset, offsetMinutes, phoneZone, readClock } from "@/features/clocks/clock";
import { tripZones, zoneTitle } from "@/features/clocks/tripZones";
import { trackEvent } from "@/shared/analytics/umami";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/shared/analytics/umami", () => ({ trackEvent: vi.fn(), trackPageView: vi.fn() }));
vi.mock("@/features/clocks/clock", async (original) => ({ ...(await original()), phoneZone: vi.fn(() => "America/Chicago") }));

// Chicago → Okinawa → Taipei → home, as the read model gives it (zones filled in).
const OKINAWA = {
  id: "trip-1",
  name: "Okinawa & Taipei",
  role: "owner",
  timezone: "America/Chicago",
  startDate: "2026-10-29",
  endDate: "2026-11-13",
  travels: [
    { depart: "2026-10-29T00:30", arrive: "2026-10-30T16:05", departZone: "America/Chicago", arriveZone: "Asia/Tokyo", from: { city: "Chicago" }, to: { name: "Naha Airport", city: "Naha" } },
    { depart: "2026-11-08T10:00", arrive: "2026-11-08T10:40", departZone: "Asia/Tokyo", arriveZone: "Asia/Taipei", from: { city: "Naha" }, to: { city: "Taipei" } },
    { depart: "2026-11-13T09:00", arrive: "2026-11-13T07:00", departZone: "Asia/Taipei", arriveZone: "America/Chicago", from: { city: "Taipei" }, to: { city: "Chicago" } },
  ],
  stays: [
    { checkIn: "2026-10-30T15:00", zone: "Asia/Tokyo", location: { city: "Naha" }, name: "Hotel" },
    { checkIn: "2026-11-02T15:00", zone: "Asia/Tokyo", location: { city: "Onna" }, name: "Resort" },
    { checkIn: "2026-11-05T15:00", zone: "Asia/Tokyo", location: { name: "Zamami Inn" }, name: "Zamami Inn" },
  ],
  days: [{ date: "2026-11-09", items: [{ zone: "Asia/Taipei", location: { city: "Jiufen" } }, { zone: "Asia/Taipei", location: null }] }],
};

// 2026-10-06 20:15:07 UTC: 3:15 PM in Chicago (CDT), 5:15 AM the next day in Tokyo.
const NOW = new Date("2026-10-06T20:15:07Z");

describe("tripZones", () => {
  it("lists each zone once, in the order the trip reaches it, named by its places", () => {
    expect(tripZones(OKINAWA)).toEqual([
      { zone: "America/Chicago", places: ["Chicago"] },
      { zone: "Asia/Tokyo", places: ["Naha", "Onna", "Zamami Inn"] },
      { zone: "Asia/Taipei", places: ["Taipei", "Jiufen"] },
    ]);
  });

  it("is the trip's own zone when nothing has one", () => {
    expect(tripZones({ timezone: "Europe/Zurich", travels: [], stays: [], days: [] })).toEqual([{ zone: "Europe/Zurich", places: [] }]);
  });

  it("titles a zone by up to two places, else the zone's city", () => {
    expect(zoneTitle({ zone: "Asia/Tokyo", places: ["Naha", "Onna", "Zamami Inn"] })).toBe("Naha · Onna · +1");
    expect(zoneTitle({ zone: "Asia/Taipei", places: [] })).toBe("Taipei");
  });
});

describe("clock readings", () => {
  it("reads a zone's time, date and offset at an instant", () => {
    expect(readClock("America/Chicago", NOW)).toEqual({ time: "3:15", seconds: "07", period: "PM", hour24: 15, date: "Tue, Oct 6" });
    expect(readClock("Asia/Tokyo", NOW)).toMatchObject({ time: "5:15", period: "AM", date: "Wed, Oct 7" });
    expect(readClock("Asia/Tokyo", new Date("2026-10-06T15:00:00Z"))).toMatchObject({ time: "12:00", period: "AM", hour24: 0 });
    expect(offsetMinutes("Asia/Tokyo", NOW)).toBe(540);
    expect(offsetMinutes("America/Chicago", NOW)).toBe(-300);
    expect(offsetMinutes("Asia/Kolkata", NOW)).toBe(330);
    // After Chicago falls back (Nov 1), it's an hour further from Tokyo.
    expect(offsetMinutes("America/Chicago", new Date("2026-11-05T12:00:00Z"))).toBe(-360);
  });

  it("formats offsets and the difference from the phone", () => {
    expect(formatUtcOffset(540)).toBe("UTC+9");
    expect(formatUtcOffset(-300)).toBe("UTC−5");
    expect(formatUtcOffset(330)).toBe("UTC+5:30");
    expect(compareToPhone(840)).toBe("14 hours ahead");
    expect(compareToPhone(-60)).toBe("1 hour behind");
    expect(compareToPhone(-330)).toBe("5 h 30 min behind");
    expect(compareToPhone(30)).toBe("30 min ahead");
    expect(compareToPhone(0)).toBe("Same time as you");
  });
});

function renderPage() {
  const store = configureStore({
    reducer: { auth: authReducer, journal: journalReducer, timeline: timelineReducer, network: networkReducer, error: errorReducer, notification: notificationReducer },
    preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/trips/trip-1/time"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/time" element={<ClocksPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe("the Time zones page", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAll();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    apiClient.get.mockResolvedValue({ data: OKINAWA });
  });
  afterEach(() => vi.useRealTimers());

  it("shows a clock per zone in trip order; the phone's zone says you're here", async () => {
    renderPage();
    const zones = await screen.findByRole("region", { name: "The trip's time zones" });
    const clocks = within(zones).getAllByRole("region");
    expect(clocks.map((c) => c.getAttribute("aria-label"))).toEqual(["Chicago", "Naha · Onna · +1", "Taipei · Jiufen"]);
    expect(clocks[0]).toHaveTextContent("You’re here · UTC−5");
    expect(trackEvent.mock.calls).toEqual([["timezones-view", { url: "/trip/timezones", role: "owner" }]]);
    expect(clocks[0]).toHaveTextContent("Tue, Oct 6");
    expect(within(clocks[0]).getByLabelText("3:15 PM")).toBeInTheDocument();
    expect(clocks[1]).toHaveTextContent("14 hours ahead · UTC+9");
    expect(clocks[1]).toHaveTextContent("Wed, Oct 7");
    expect(clocks[2]).toHaveTextContent("13 hours ahead · UTC+8");
    expect(screen.queryByText(/This phone/)).not.toBeInTheDocument();
  });

  it("away from every trip zone, the phone gets its own clock first", async () => {
    phoneZone.mockReturnValue("Europe/London");
    renderPage();
    const phone = await screen.findByRole("region", { name: "This phone · London" });
    expect(phone).toHaveTextContent("UTC+1");
    const zones = screen.getByRole("region", { name: "The trip's time zones" });
    expect(within(zones).getByRole("region", { name: "Chicago" })).toHaveTextContent("6 hours behind");
  });

  it("ticks every second", async () => {
    renderPage();
    const chicago = await screen.findByRole("region", { name: "Chicago" });
    expect(chicago).toHaveTextContent("07");
    await vi.advanceTimersByTimeAsync(2000);
    expect(chicago).toHaveTextContent("09");
  });
});
