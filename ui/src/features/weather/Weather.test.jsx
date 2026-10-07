import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import weatherReducer from "@/features/weather/weatherSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { WeatherPage } from "@/features/weather/WeatherPage";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll, saveWeather } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const USER = "user-1";
const FETCHED = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
const WEATHER = {
  configured: true,
  problem: null,
  today: {
    place: "Naha",
    zone: "Asia/Tokyo",
    observedAt: FETCHED,
    temp: 27.5,
    feelsLike: 30.1,
    condition: "Clouds",
    description: "broken clouds",
    icon: "04d",
    humidity: 75,
    windSpeed: 4,
    uvi: 6,
    sunrise: "2026-10-29T21:12:00Z",
    sunset: "2026-10-30T08:40:00Z",
    fetchedAt: FETCHED,
  },
  days: [
    { date: "2026-10-28", place: "Chicago", kind: "past" },
    {
      date: "2026-10-30",
      place: "Naha",
      zone: "Asia/Tokyo",
      kind: "forecast",
      high: 28,
      low: 22,
      pop: 0.4,
      rain: 2.4,
      windSpeed: 5.5,
      windGust: 9,
      uvi: 7.1,
      humidity: 70,
      icon: "10d",
      condition: "Rain",
      description: "light rain",
      summary: "Expect a day of partly cloudy with rain",
      fetchedAt: FETCHED,
    },
    { date: "2026-11-09", place: "Taipei", zone: "Asia/Taipei", kind: "outlook", high: 26.5, low: 21, rain: 3.2, windSpeed: 7.7, fetchedAt: FETCHED },
    { date: "2026-11-13", place: "Taipei", kind: "unavailable" },
  ],
  alerts: [
    { place: "Naha", event: "Typhoon warning", sender: "JMA", start: FETCHED, end: FETCHED, description: "Strong winds." },
  ],
};

function renderPage({ online = true } = {}) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      weather: weatherReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: fakeToken(USER), user: null, status: "idle" }, network: { online } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/trips/trip-1/weather"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/weather" element={<WeatherPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

function serve(weather) {
  apiClient.get.mockImplementation(async (url) => {
    if (url.endsWith("/weather")) {
      if (weather instanceof Error) throw weather;
      return { data: weather };
    }
    return { data: { id: "trip-1", name: "Okinawa & Taipei", role: "viewer", days: [], stays: [], travels: [] } };
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
});

describe("the Weather page", () => {
  it("shows right now, alerts, and each trip day in °F with °C", async () => {
    serve(WEATHER);
    renderPage();
    const now = await screen.findByRole("region", { name: "Right now" });
    expect(within(now).getByText(/Naha/)).toBeInTheDocument();
    expect(within(now).getByText("82°")).toBeInTheDocument();
    expect(within(now).getByText("28°C")).toBeInTheDocument();
    expect(within(now).getByText("broken clouds")).toBeInTheDocument();
    expect(within(now).getByText(/Feels like 86°/)).toBeInTheDocument();
    expect(screen.getByText(/Typhoon warning · Naha/)).toBeInTheDocument();
    expect(screen.getByText(/Updated 2 hours ago/)).toBeInTheDocument();

    const days = within(screen.getByRole("region", { name: "Trip days" })).getAllByRole("listitem");
    expect(days).toHaveLength(3); // the past day is folded into a count
    expect(days[0]).toHaveTextContent("Naha");
    expect(days[0]).toHaveTextContent("82°"); // 28 °C high
    expect(days[0]).toHaveTextContent("40% · 0.1 in");
    expect(days[0]).toHaveTextContent("12 mph, gusts 20");
    expect(days[0]).toHaveTextContent("Expect a day of partly cloudy with rain");
    expect(days[1]).toHaveTextContent("Long-range outlook");
    expect(days[2]).toHaveTextContent("No forecast yet");
    expect(screen.getByText("1 day already past.")).toBeInTheDocument();
  });

  it("says when weather isn't set up (no key on the server)", async () => {
    serve({ configured: false, problem: null, today: null, days: [], alerts: [] });
    renderPage();
    expect(await screen.findByText("Weather isn’t set up")).toBeInTheDocument();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });

  it("passes on what couldn't be updated", async () => {
    serve({ ...WEATHER, problem: "OpenWeatherMap's daily call limit was reached" });
    renderPage();
    expect(await screen.findByRole("status")).toHaveTextContent("daily call limit");
  });

  it("offline, shows the saved copy with its age", async () => {
    await saveWeather(USER, "trip-1", WEATHER);
    serve(new Error("Network Error"));
    renderPage({ online: false });
    expect(await screen.findByRole("region", { name: "Right now" })).toBeInTheDocument();
    expect(screen.getByText(/Updated 2 hours ago · offline/)).toBeInTheDocument();
  });

  it("with nothing saved and no connection, says so", async () => {
    serve(new Error("Network Error"));
    renderPage({ online: false });
    expect(await screen.findByText("Couldn’t load the weather")).toBeInTheDocument();
  });
});

describe("the drawer's Trip tools", () => {
  async function openDrawer(path, timeline) {
    const { TopBar } = await import("@/shared/components/TopBar");
    const store = configureStore({
      reducer: { auth: authReducer, journal: journalReducer, timeline: timelineReducer, network: networkReducer, error: errorReducer, notification: notificationReducer },
      preloadedState: {
        auth: { token: fakeToken(USER), user: { email: "u@x.com" }, status: "idle" },
        ...(timeline && { timeline: { ...timelineReducer(undefined, { type: "init" }), ...timeline, tripId: timeline.trip.id } }),
      },
    });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <TopBar title="x" />
        </MemoryRouter>
      </Provider>
    );
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    return screen.getByRole("navigation", { name: "Menu" });
  }

  it("shows Weather and Currency for the trip on screen", async () => {
    const menu = await openDrawer("/trips/trip-1/days/2026-10-30");
    const tools = within(menu).getByRole("region", { name: "Trip tools" });
    expect(within(tools).getByRole("link", { name: "Weather" })).toHaveAttribute("href", "/trips/trip-1/weather");
    expect(within(tools).getByRole("link", { name: "Currency" })).toHaveAttribute("href", "/trips/trip-1/currency");
    expect(within(tools).getByRole("link", { name: "Time zones" })).toHaveAttribute("href", "/trips/trip-1/time");
  });

  it("lists Currency first, then Weather, Time zones, Packing, Documents, and Share trip for the owner", async () => {
    apiClient.get.mockResolvedValue({ data: [] }); // the Share dialog's members and codes
    const menu = await openDrawer("/trips/trip-1", { trip: { id: "trip-1", name: "x", role: "owner" } });
    const tools = within(menu).getByRole("region", { name: "Trip tools" });
    const names = [...tools.querySelectorAll("a, button")].map((el) => el.textContent.trim());
    expect(names).toEqual(["Currency", "Weather", "Time zones", "Packing", "Documents", "Share trip"]);
    await userEvent.click(within(tools).getByRole("button", { name: "Share trip" }));
    expect(await screen.findByRole("dialog", { name: "Share trip" })).toBeInTheDocument();
  });

  it("an editor gets Documents but not Share trip", async () => {
    const menu = await openDrawer("/trips/trip-1", { trip: { id: "trip-1", name: "x", role: "editor" } });
    const tools = within(menu).getByRole("region", { name: "Trip tools" });
    expect(within(tools).getByRole("link", { name: "Documents" })).toBeInTheDocument();
    expect(within(tools).queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
  });

  it("has no Trip tools outside a trip", async () => {
    const menu = await openDrawer("/trips");
    expect(within(menu).queryByRole("region", { name: "Trip tools" })).not.toBeInTheDocument();
  });
});

describe("a tool page's top bar", () => {
  /** Opens at `entry`; the day page has a button that moves to the tool, as the drawer does. */
  async function renderTool(entry) {
    const { ToolLayout } = await import("@/shared/components/ToolLayout");
    const { useNavigate } = await import("react-router-dom");
    function DayPage() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/trips/trip-1/weather")}>The day page: open the tool</button>;
    }
    const store = configureStore({
      reducer: { auth: authReducer, journal: journalReducer, network: networkReducer, error: errorReducer, notification: notificationReducer },
      preloadedState: { auth: { token: fakeToken(USER), user: null, status: "idle" } },
    });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/trips/:tripId/weather" element={<ToolLayout tripId="trip-1" title="Okinawa">Tool</ToolLayout>} />
            <Route path="/trips/:tripId/days/:date" element={<DayPage />} />
            <Route path="/trips/:tripId/today" element={<p>The Today page</p>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  }

  it("has ← instead of ☰, back to where you came from", async () => {
    await renderTool("/trips/trip-1/days/2026-10-30");
    await userEvent.click(screen.getByRole("button", { name: /open the tool/ }));
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /The day page/ })).toBeInTheDocument();
  });

  it("opened directly, ← goes to the trip", async () => {
    await renderTool("/trips/trip-1/weather");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("The Today page")).toBeInTheDocument();
  });
});
