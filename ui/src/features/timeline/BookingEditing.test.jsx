import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
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
  trip.stays.forEach((s, i) => Object.assign(s, { id: `stay-${i}`, zone: "Europe/Zurich" }));
  trip.travels.forEach((t, i) =>
    Object.assign(t, { id: `travel-${i}`, departZone: "Europe/Zurich", arriveZone: "Europe/Zurich" })
  );
  Object.assign(trip.travels[0], { departZone: "America/Chicago" });
  Object.assign(trip.travels[3], { arriveZone: "America/Chicago" });
  trip.days.forEach((day, d) =>
    day.items.forEach((item, i) => Object.assign(item, { id: `item-${d}-${i}`, zone: "Europe/Zurich" }))
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
        initialEntries={[`/trips/trip-1?day=${date}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

async function openAdd(user, kind, dayName = "Mon, May 11") {
  await user.click(await screen.findByRole("button", { name: `Add to ${dayName}` }));
  await user.click(screen.getByRole("button", { name: `Add ${kind} on ${dayName}` }));
  return screen.getByRole("dialog");
}

async function pickPlace(user, dialog, label, typed, option) {
  await user.type(within(dialog).getByRole("combobox", { name: label }), typed);
  await user.click(await within(dialog).findByRole("button", { name: new RegExp(option) }));
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

describe("adding travel", () => {
  it("needs where it leaves from and when, and warns until the arrival is set", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: readTrip() });
    renderDay("2026-05-11");
    const dialog = await openAdd(user, "travel");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText(/Pick where it leaves from/)).toBeInTheDocument();
    expect(within(dialog).getByText("Departure date and time are required")).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();

    await pickPlace(user, dialog, "From", "zür", "Zürich Airport");
    expect(await within(dialog).findByText("Times here are Zurich time")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Arrival time")).toBeDisabled();
    expect(within(dialog).getByRole("status")).toHaveTextContent("No arrival place yet");

    await user.type(within(dialog).getByLabelText("Departure time"), "16:05");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "Train");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/travels",
      {
        title: "From Zürich Airport",
        mode: "train",
        from: { placeId: "zrh", name: "Zürich Airport", address: "8058 Zürich, Switzerland", lat: 47.4581, lng: 8.5555 },
        depart: "2026-05-11T16:05",
      },
      { silent: true }
    );
  });

  it("names the leg after its places and spells out a cross-zone flight", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: readTrip() });
    renderDay("2026-05-11");
    const dialog = await openAdd(user, "travel");

    await pickPlace(user, dialog, "From", "hare", "O'Hare");
    await pickPlace(user, dialog, "To", "zür", "Zürich Airport");
    expect(within(dialog).getByLabelText("Title")).toHaveValue("O'Hare International Airport → Zürich Airport");
    expect(within(dialog).getByLabelText("Arrival time")).toBeEnabled();
    expect(within(dialog).getByLabelText("Arrival date")).toHaveValue("2026-05-11");

    await user.type(within(dialog).getByLabelText("Departure time"), "07:40");
    await user.type(within(dialog).getByLabelText("Arrival time"), "23:25");
    expect(
      await within(dialog).findByText(/Departs 7:40 AM Chicago time · lands 11:25 PM Zurich time/)
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const [, body] = apiClient.post.mock.calls[0];
    expect(body).toMatchObject({
      title: "O'Hare International Airport → Zürich Airport",
      depart: "2026-05-11T07:40",
      arrive: "2026-05-11T23:25",
    });
  });
});

describe("editing travel", () => {
  it("edits a leg from its marker, sending the whole leg back", async () => {
    const user = userEvent.setup();
    apiClient.put.mockResolvedValue({ data: readTrip() });
    renderDay("2026-05-10");

    await screen.findByRole("heading", { name: "Sun, May 10" });
    const may10 = document.getElementById("day-2026-05-10");
    await user.click(within(may10).getByRole("button", { name: /Chicago → Zürich/ }));
    await user.click(within(may10).getByRole("button", { name: "Edit travel Chicago → Zürich" }));
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
    const card = await screen.findByRole("button", { name: /Zürich → Chicago/ });
    expect(card).toHaveTextContent("No arrival yet");
  });
});

describe("stays", () => {
  it("adds a stay with prefilled times, requiring where it is", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: readTrip() });
    renderDay("2026-05-11");
    const dialog = await openAdd(user, "stay");

    expect(within(dialog).getByLabelText("Check-in date")).toHaveValue("2026-05-11");
    expect(within(dialog).getByLabelText("Check-in time")).toHaveValue("15:00");
    expect(within(dialog).getByLabelText("Check-out date")).toHaveValue("2026-05-12");
    expect(within(dialog).getByLabelText("Check-out time")).toHaveValue("11:00");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText(/Pick where you’re staying/)).toBeInTheDocument();

    await pickPlace(user, dialog, "Where", "bell", "Hotel Bellevue Palace");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Hotel Bellevue Palace");
    await user.type(within(dialog).getByLabelText("Room"), "Junior suite");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/stays",
      {
        name: "Hotel Bellevue Palace",
        type: "hotel",
        checkIn: "2026-05-11T15:00",
        checkOut: "2026-05-12T11:00",
        location: { placeId: "bel", name: "Hotel Bellevue Palace", address: "Kochergasse 3-5, Bern", lat: 46.9466, lng: 7.4442 },
        roomType: "Junior suite",
      },
      { silent: true }
    );
  });

  it("checks check-out is after check-in", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    const dialog = await openAdd(user, "stay");
    await pickPlace(user, dialog, "Where", "bell", "Hotel Bellevue Palace");
    await user.clear(within(dialog).getByLabelText("Check-out date"));
    await user.type(within(dialog).getByLabelText("Check-out date"), "2026-05-11");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Check-out must be after check-in")).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("deletes a stay from any of its markers", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    updated.stays.splice(1, 1);
    apiClient.delete.mockResolvedValue({ data: updated });
    renderDay("2026-05-13");

    await user.click(await screen.findByRole("button", { name: /Staying at Beausite Park Hotel/ }));
    await user.click(screen.getByRole("button", { name: "Delete stay Beausite Park Hotel" }));
    const confirm = screen.getByRole("dialog", { name: "Delete stay?" });
    expect(confirm).toHaveTextContent("removed from every day it covers");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/stays/stay-1", { silent: true });
    expect(screen.queryByText(/Staying at Beausite/)).not.toBeInTheDocument();
  });
});

describe("place search", () => {
  it("falls back to a typed name when search is unavailable", async () => {
    const user = userEvent.setup();
    createPlacesSearch.mockRejectedValue(new Error("no key"));
    renderDay("2026-05-11");
    const dialog = await openAdd(user, "stay");

    await user.type(within(dialog).getByRole("combobox", { name: "Where" }), "Gasthaus Sonne");
    expect(await within(dialog).findByText("Place search is unavailable.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Use “Gasthaus Sonne” as typed" }));
    expect(within(dialog).getByText("Not on the map, so times use Zurich time")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Where")).toHaveValue("Gasthaus Sonne");
  });

  it("biases suggestions towards the trip's stays", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    const dialog = await openAdd(user, "activity");
    await user.type(within(dialog).getByRole("combobox", { name: "Place" }), "bell");
    await within(dialog).findByRole("button", { name: /Hotel Bellevue Palace/ });
    expect(fakeSearch.suggest).toHaveBeenLastCalledWith("bell", {
      lat: sampleTrip.stays[0].location.lat,
      lng: sampleTrip.stays[0].location.lng,
    });
  });
});
