import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import weatherReducer from "@/features/weather/weatherSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { TodayPage } from "@/features/today/TodayPage";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
import { untilLabel } from "@/features/today/todayView";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z" };
TRIP.stays = TRIP.stays.map((s, i) => ({ ...s, id: `stay-${i}`, confirmationNumber: s.confirmationNumber ?? `CONF-${i}` }));

function renderAt(path) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      timeline: timelineReducer,
      weather: weatherReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/today" element={<TodayPage />} />
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: TRIP });
});
afterEach(() => vi.useRealTimers());

describe("Today tab", () => {
  it("before the trip, previews day 1 and says so", async () => {
    vi.useFakeTimers({ now: new Date("2026-04-01T12:00:00Z"), toFake: ["Date"] });
    renderAt("/trips/trip-1/today");
    expect(await screen.findByRole("heading", { name: "Day 1 preview" })).toBeInTheDocument();
    expect(screen.getByText(/The trip isn’t under way/)).toBeInTheDocument();
    expect(screen.getByText("Sun, May 10 · Day 1 of 5")).toBeInTheDocument();
    const next = screen.getByRole("region", { name: "Next up" });
    expect(within(next).getByText("Chicago → Zürich")).toBeInTheDocument();
    expect(within(next).getByRole("link", { name: "Directions" })).toHaveAttribute(
      "href",
      expect.stringContaining("google.com/maps/dir/")
    );
    expect(within(screen.getByRole("region", { name: "Tonight" })).getByText("No stay booked for tonight.")).toBeInTheDocument();
  });

  it("during the trip, follows today: next up with time to go, tonight's stay and its confirmation", async () => {
    // May 11, 11:00 in Zurich (09:00Z): after the 10:28 train, before the 12:15 lunch.
    vi.useFakeTimers({ now: new Date("2026-05-11T09:00:00Z"), toFake: ["Date"] });
    renderAt("/trips/trip-1/today");
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    const next = screen.getByRole("region", { name: "Next up" });
    expect(within(next).getByText("Lunch at Altes Tramdepot")).toBeInTheDocument();
    expect(within(next).getByText(/in 1 h 15 min/)).toBeInTheDocument();

    const tonight = screen.getByRole("region", { name: "Tonight" });
    expect(within(tonight).getByText(TRIP.stays[0].name)).toBeInTheDocument();
    expect(within(tonight).getByText(TRIP.stays[0].confirmationNumber)).toBeInTheDocument();

    const plan = screen.getByRole("region", { name: "Today’s plan" });
    expect(within(plan).getByText("Dinner at Kornhauskeller")).toBeInTheDocument();
    // Every row, and Next up and Tonight, open the entry's own page.
    expect(within(plan).getByRole("link", { name: /Dinner at Kornhauskeller/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/trips\/trip-1\/activities\//)
    );
    expect(within(next).getByRole("link", { name: "Details" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/trips\/trip-1\/activities\//)
    );
    expect(within(tonight).getByRole("link", { name: "Details" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/trips\/trip-1\/stays\//)
    );
    expect(within(screen.getByRole("region", { name: "Tomorrow" })).getByRole("link")).toHaveAttribute(
      "href",
      "/trips/trip-1/days/2026-05-12"
    );
  });

  it("on a changeover day, shows this morning's check-out too", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-12T06:00:00Z"), toFake: ["Date"] });
    renderAt("/trips/trip-1/today");
    const tonight = await screen.findByRole("region", { name: "Tonight" });
    expect(within(tonight).getByText(/Check out of/)).toHaveTextContent(`Check out of ${TRIP.stays[0].name} by 10:00`);
    expect(within(tonight).getByText(TRIP.stays[1].name)).toBeInTheDocument();
    // Tonight is Beausite's check-in night: when to arrive.
    expect(within(tonight).getByText(/^Check-in /)).toHaveTextContent("Check-in Tue, May 12 · 3:00 PM");
  });

  it("once you're staying, Tonight says when to check out, not the check-in you've done", async () => {
    // May 13: the Beausite's second night (checked in May 12, out May 14).
    vi.useFakeTimers({ now: new Date("2026-05-13T08:00:00Z"), toFake: ["Date"] });
    renderAt("/trips/trip-1/today");
    const tonight = await screen.findByRole("region", { name: "Tonight" });
    expect(within(tonight).getByText(TRIP.stays[1].name)).toBeInTheDocument();
    expect(within(tonight).getByText(/^Check-out /)).toHaveTextContent("Check-out Thu, May 14 · 10:00 AM");
    expect(within(tonight).queryByText(/^Check-in /)).toBeNull();
  });
});

describe("timeline: past days", () => {
  it("greys past days and marks today", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-12T09:00:00Z"), toFake: ["Date"] });
    renderAt("/trips/trip-1");
    await screen.findByRole("list", { name: "Trip days" });
    const card = (date) => document.querySelector(`#day-${date} > div`);
    expect(card("2026-05-11")).toHaveClass("opacity-55");
    expect(card("2026-05-12")).not.toHaveClass("opacity-55");
    expect(within(document.querySelector("#day-2026-05-12")).getByText("Today")).toBeInTheDocument();
    expect(card("2026-05-13")).not.toHaveClass("opacity-55");
  });
});

describe("untilLabel", () => {
  it("reads naturally", () => {
    const now = 0;
    expect(untilLabel(30_000, now)).toBe("now");
    expect(untilLabel(25 * 60_000, now)).toBe("in 25 min");
    expect(untilLabel(3 * 3_600_000, now)).toBe("in 3 h");
    expect(untilLabel(3 * 3_600_000 + 10 * 60_000, now)).toBe("in 3 h 10 min");
    expect(untilLabel(2 * 86_400_000, now)).toBe("in 2 days");
  });
});

describe("the temperature on Today", () => {
  const weather = (today) => ({ configured: true, today, days: [], alerts: [] });
  const serve = (w) =>
    apiClient.get.mockImplementation(async (url) => ({ data: url.endsWith("/weather") ? w : TRIP }));

  it("shows it now at today's place, in °F, linking to Weather", async () => {
    serve(weather({ place: "Bern", temp: 17.4, icon: "10d", condition: "Rain" }));
    renderAt("/trips/trip-1/today");
    const link = await screen.findByRole("link", { name: "Weather in Bern: 63°F, 17°C" });
    expect(link).toHaveAttribute("href", "/trips/trip-1/weather");
    expect(link).toHaveTextContent("63°");
    // Where New memory was: beside the heading (New memory is in the top bar now).
    expect(link.parentElement).toContainElement(screen.getByRole("heading", { level: 1 }));
  });

  it("shows nothing when weather isn't set up", async () => {
    serve({ configured: false });
    renderAt("/trips/trip-1/today");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: /^Weather in/ })).not.toBeInTheDocument();
  });
});
