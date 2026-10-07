import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { BottomNav } from "@/shared/components/BottomNav";
import { NotForViewers } from "@/shared/components/NotForViewers";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({ apiClient: { get: vi.fn() } }));

const trip = (role) => ({ id: "trip-1", name: "Bern", role, startDate: "2026-05-10", endDate: "2026-05-14", timezone: "Europe/Zurich", days: [], stays: [], travels: [] });
const toolRendered = vi.fn();

function Tool() {
  toolRendered();
  return <p>The weather page</p>;
}

function renderAt(path) {
  const store = configureStore({
    reducer: { auth: authReducer, timeline: timelineReducer, network: networkReducer, error: errorReducer, notification: notificationReducer },
    preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId" element={<p>The timeline</p>} />
          <Route
            path="/trips/:tripId/weather"
            element={
              <NotForViewers>
                <Tool />
              </NotForViewers>
            }
          />
        </Routes>
        <BottomNav tripId="trip-1" />
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
});

describe("what a viewer gets", () => {
  it("a viewer opening Today or a Trip tool goes to the timeline, and the tool never starts", async () => {
    apiClient.get.mockResolvedValue({ data: trip("viewer") });
    renderAt("/trips/trip-1/weather");
    expect(await screen.findByText("The timeline")).toBeInTheDocument();
    expect(toolRendered).not.toHaveBeenCalled();
  });

  it.each(["owner", "editor"])("the %s gets the page", async (role) => {
    apiClient.get.mockResolvedValue({ data: trip(role) });
    renderAt("/trips/trip-1/weather");
    expect(await screen.findByText("The weather page")).toBeInTheDocument();
  });

  it("a trip that can't be read at all: the page says so itself", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    renderAt("/trips/trip-1/weather");
    expect(await screen.findByText("The weather page")).toBeInTheDocument();
  });

  it.each([
    ["viewer", ["Timeline", "Journal", "Map"]],
    ["editor", ["Today", "Timeline", "Journal", "Map"]],
  ])("a %s's tab bar", async (role, tabs) => {
    apiClient.get.mockResolvedValue({ data: trip(role) });
    renderAt("/trips/trip-1/weather"); // the guard loads the trip
    await vi.waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    const nav = await screen.findByRole("navigation", { name: "Trip" });
    await vi.waitFor(() => expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual(tabs));
  });
});
