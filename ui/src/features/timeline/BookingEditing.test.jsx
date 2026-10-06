import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { tripRoutes } from "@/test/tripRoutes";
import { apiClient } from "@/shared/services/apiClient";
import { createPlacesSearch } from "@/shared/services/googlePlaces";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/shared/services/googlePlaces", () => ({
  createPlacesSearch: vi.fn(),
  PlacesUnavailable: class PlacesUnavailable extends Error {},
}));

// What the fake Google search knows about.
const PLACES = [
  { placeId: "zrh", name: "Zürich Airport", address: "8058 Zürich, Switzerland", lat: 47.4581, lng: 8.5555 },
  { placeId: "ord", name: "O'Hare International Airport", address: "Chicago, IL, USA", lat: 41.9786, lng: -87.9048 },
  { placeId: "bel", name: "Hotel Bellevue Palace", address: "Kochergasse 3-5, Bern", lat: 46.9466, lng: 7.4442 },
];

const fakeSearch = {
  suggest: vi.fn(async (input) =>
    PLACES.filter((p) => p.name.toLowerCase().includes(input.toLowerCase())).map((p) => ({
      placeId: p.placeId,
      primary: p.name,
      secondary: p.address,
    }))
  ),
  pick: vi.fn(async (s) => ({ ...PLACES.find((p) => p.placeId === s.placeId) })),
};

/** The sample trip in the API's read shape: ids and the server's computed zones. */
function readTrip() {
  const trip = structuredClone(sampleTrip);
  trip.id = "trip-1";
  trip.stays.forEach((s, i) => Object.assign(s, { id: `stay-${i}`, zone: "Europe/Zurich", version: 1 }));
  trip.travels.forEach((t, i) =>
    Object.assign(t, { id: `travel-${i}`, departZone: "Europe/Zurich", arriveZone: "Europe/Zurich", version: 1 })
  );
  Object.assign(trip.travels[0], { departZone: "America/Chicago" });
  Object.assign(trip.travels[3], { arriveZone: "America/Chicago" });
  trip.days.forEach((day, d) =>
    day.items.forEach((item, i) => Object.assign(item, { id: `item-${d}-${i}`, zone: "Europe/Zurich", version: 1 }))
  );
  return trip;
}

let trip;

function renderDay(date) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      timeline: timelineReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[`/trips/trip-1/days/${date}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>{tripRoutes()}</Routes>
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  trip = readTrip();
  createPlacesSearch.mockResolvedValue(fakeSearch);
  apiClient.get.mockImplementation(async (url, config) => {
    if (url === "/timezone") {
      return { data: { timezone: config.params.lng < 0 ? "America/Chicago" : "Europe/Zurich" } };
    }
    return { data: trip };
  });
});

describe("editing travel", () => {
  it("edits a leg from its page, opened from its marker, sending the whole leg back", async () => {
    const user = userEvent.setup();
    apiClient.put.mockResolvedValue({ data: readTrip() });
    renderDay("2026-05-10");

    await screen.findByRole("heading", { name: "Sun, May 10" });
    const plans = screen.getByRole("list", { name: /^Plans for/ });
    await user.click(within(plans).getByRole("link", { name: /Chicago → Zürich/ }));
    await user.click(await screen.findByRole("button", { name: "Edit travel" }));
    const dialog = screen.getByRole("dialog", { name: "Edit travel" });
    expect(within(dialog).getByLabelText("From")).toHaveValue("Chicago O'Hare (ORD)");
    expect(within(dialog).getByLabelText("Seat")).toHaveValue("23A");
    await user.clear(within(dialog).getByLabelText("Seat"));
    await user.type(within(dialog).getByLabelText("Seat"), "23B");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const [url, body] = apiClient.put.mock.calls[0];
    expect(url).toBe("/trips/trip-1/travels/travel-0");
    const expected = { ...sampleTrip.travels[0], seat: "23B" };
    expect(body).toEqual(expected);
  });

  it("flags a leg with no arrival on the timeline", async () => {
    delete trip.travels[3].arrive;
    renderDay("2026-05-14");
    const plans = await screen.findByRole("list", { name: "Plans for Thu, May 14" });
    const card = within(plans).getByRole("link", { name: /Zürich → Chicago/ });
    expect(card).toHaveTextContent("No arrival yet");
  });
});

describe("stays", () => {
  it("deletes a stay from its page, opened from any of its markers", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    updated.stays.splice(1, 1);
    apiClient.delete.mockImplementation(async () => {
      trip = updated; // the server has it gone now
      return { data: updated };
    });
    renderDay("2026-05-13");

    await user.click(await screen.findByRole("link", { name: /Staying at Beausite Park Hotel/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete stay?" });
    expect(confirm).toHaveTextContent("removed from every day it covers");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/stays/stay-1", {
      silent: true,
      handles: [404, 409, 428],
      headers: { "If-Match": '"1"' },
    });
    // Back on its first day (check-in), without it.
    expect(await screen.findByRole("heading", { name: "Tue, May 12" })).toBeInTheDocument();
    expect(screen.queryByText(/Beausite/)).not.toBeInTheDocument();
  });
});

describe("place search", () => {
  it("biases suggestions towards the trip's stays", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    await user.click(await screen.findByRole("button", { name: "Add activity to Mon, May 11" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("combobox", { name: "Place" }), "bell");
    await within(dialog).findByRole("button", { name: /Hotel Bellevue Palace/ });
    expect(fakeSearch.suggest).toHaveBeenLastCalledWith("bell", {
      lat: sampleTrip.stays[0].location.lat,
      lng: sampleTrip.stays[0].location.lng,
    });
  });
});
