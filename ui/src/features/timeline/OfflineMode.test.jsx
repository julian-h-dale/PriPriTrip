import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { EntryPage } from "@/features/entry/EntryPage";
import { DayDetailPage } from "@/features/timeline/DayDetailPage";
import { TripsPage } from "@/features/trips/TripsPage";
import { MapPage } from "@/features/map/MapPage";
import { apiClient } from "@/shared/services/apiClient";
import { loadGoogleMapsLibrary } from "@/shared/services/googleMapsLoader";
import { clearAll, saveTrip, saveTripList } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
// A mini map asking for Google's library is a map loading over the network.
vi.mock("@/shared/services/googleMapsLoader", async (original) => ({
  ...(await original()),
  loadGoogleMapsLibrary: vi.fn(() => new Promise(() => {})),
}));

const USER = "user-1";
const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z" };
TRIP.days.forEach((d, i) => d.items.forEach((item, j) => (item.id = `item-${i}-${j}`)));
const SUMMARY = {
  id: "trip-1",
  name: TRIP.name,
  startDate: TRIP.startDate,
  endDate: TRIP.endDate,
  timezone: TRIP.timezone,
  stayCount: 2,
  travelCount: 4,
  createdAt: TRIP.createdAt,
};
const networkError = () => Object.assign(new Error("Network Error"), { config: {} });

function renderAt(path, online = false, savedOnly = false) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      trips: tripsReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: {
      auth: { token: fakeToken(USER), user: null, status: "idle" },
      network: { online, savedOnly },
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:tripId/days/:date" element={<DayDetailPage />} />
          <Route path="/trips/:tripId/activities/:id" element={<EntryPage kind="activity" />} />
          <Route path="/trips/:tripId/map" element={<MapPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
  await saveTrip(USER, TRIP);
  await saveTripList(USER, [SUMMARY]);
  apiClient.get.mockRejectedValue(networkError());
});

describe("offline, from the phone's saved copy", () => {
  it("the trips list renders, with the offline bar, and import/delete are off", async () => {
    renderAt("/trips");
    // The sample trip is in the past: open the collapsed group.
    await userEvent.click(await screen.findByRole("button", { name: "Past (1)" }));
    expect(await screen.findByText(TRIP.name)).toBeInTheDocument();
    expect(await screen.findByText(/^Offline/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import trip/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: `More for ${TRIP.name}` }));
    expect(screen.getByRole("menuitem", { name: "Delete trip" })).toBeDisabled();
  });

  it("a day page renders and every edit control is disabled", async () => {
    renderAt("/trips/trip-1/days/2026-05-11");
    await screen.findByRole("heading", { name: "Mon, May 11" });
    expect(await screen.findByText(/^Offline · saved copy from/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add activity/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /title and summary/ })).toBeDisabled();

    // The activity's page opens from the saved copy, its actions greyed.
    await userEvent.click(screen.getByRole("link", { name: /Lunch at Altes Tramdepot/ }));
    await screen.findByRole("article", { name: "Lunch at Altes Tramdepot" });
    expect(screen.getByRole("button", { name: "Edit activity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("the map tab lists the trip's places with directions instead of a map", async () => {
    renderAt("/trips/trip-1/map");
    expect(await screen.findByText(/The map needs a connection/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /^Directions to / });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", expect.stringContaining("google.com/maps/dir/"));
  });

  it("online but the server is down: the saved copy shows, read-only, with no error toast", async () => {
    const store = renderAt("/trips/trip-1/days/2026-05-11", true);
    await screen.findByRole("heading", { name: "Mon, May 11" });
    expect(await screen.findByText(/^Can’t reach the server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add activity/ })).toBeDisabled();
    expect(store.getState().error.message).toBeFalsy();
  });
});

describe("online, with “Use saved copies only” on (Run stage 20)", () => {
  const savedOnly = (path) => renderAt(path, true, true);

  it("the trips list is the saved copy, and the bar says why", async () => {
    savedOnly("/trips");
    expect(await screen.findByText(/^Saved copies only · saved copy from/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import trip/ })).toBeDisabled();
  });

  it("a day page is read-only, as offline", async () => {
    savedOnly("/trips/trip-1/days/2026-05-11");
    await screen.findByRole("heading", { name: "Mon, May 11" });
    expect(await screen.findByText(/^Saved copies only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add activity/ })).toBeDisabled();
  });

  it("an entry's page loads no place photo and no map", async () => {
    savedOnly("/trips/trip-1/activities/item-0-0");
    await screen.findByRole("article");
    expect(document.querySelector('img[src*="googleusercontent"]')).toBeNull();
    expect(loadGoogleMapsLibrary).not.toHaveBeenCalled();
  });

  it("…while online without it, the same page has both", async () => {
    renderAt("/trips/trip-1/activities/item-0-0", true);
    await screen.findByRole("article");
    expect(document.querySelector('img[src*="googleusercontent"]')).not.toBeNull();
    expect(loadGoogleMapsLibrary).toHaveBeenCalled();
  });

  it("the map tab is the list", async () => {
    savedOnly("/trips/trip-1/map");
    expect(await screen.findByText(/The map needs a connection/)).toBeInTheDocument();
  });
});
