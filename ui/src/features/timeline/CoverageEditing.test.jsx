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

// Adding a stay or a leg now happens from the trip page's coverage views
// (selecting an uncovered date), not from the day page. See BookingEditing.test.jsx
// for editing/deleting an existing stay or leg from its marker on the day page.

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
  {
    placeId: "bel",
    name: "Hotel Bellevue Palace",
    address: "Kochergasse 3-5, Bern",
    lat: 46.9466,
    lng: 7.4442,
    imgRef: "https://places.googleapis.com/v1/places/bel/photos/abc/media",
  },
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
  return trip;
}

let trip;

function renderTrip() {
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
      <MemoryRouter initialEntries={["/trips/trip-1"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
          <Route path="/trips/:tripId/days/:date" element={<p>day page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

/** The timeline row (list item) for a date. */
function day(date) {
  return document.getElementById(`day-${date}`);
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

describe("adding travel from the travel coverage view", () => {
  // The sample trip's travel covers May 10-12 and 14; May 13 has none.
  async function openAddTravel(user) {
    await user.click(await screen.findByRole("button", { name: "Travel" }));
    await user.click(within(day("2026-05-13")).getByRole("button"));
    return screen.getByRole("dialog", { name: "Add travel" });
  }

  it("needs where it leaves from and when, and warns until the arrival is set", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: readTrip() });
    renderTrip();
    const dialog = await openAddTravel(user);

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
        depart: "2026-05-13T16:05",
      },
      { silent: true }
    );
  });

  it("names the leg after its places and spells out a cross-zone flight", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: readTrip() });
    renderTrip();
    const dialog = await openAddTravel(user);

    await pickPlace(user, dialog, "From", "hare", "O'Hare");
    await pickPlace(user, dialog, "To", "zür", "Zürich Airport");
    expect(within(dialog).getByLabelText("Title")).toHaveValue("O'Hare International Airport → Zürich Airport");
    expect(within(dialog).getByLabelText("Arrival time")).toBeEnabled();
    expect(within(dialog).getByLabelText("Arrival date")).toHaveValue("2026-05-13");

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
      depart: "2026-05-13T07:40",
      arrive: "2026-05-13T23:25",
    });
  });

  it("goes to the day page instead when a date already has more than one leg", async () => {
    const user = userEvent.setup();
    renderTrip();
    await user.click(await screen.findByRole("button", { name: "Travel" }));
    // May 11 has both the overnight arrival and the Zürich -> Bern train.
    await user.click(within(day("2026-05-11")).getByRole("button"));
    expect(await screen.findByText("day page")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("opening a leg from the travel coverage view", () => {
  it("shows a read-only quick look first, not the edit form", async () => {
    const user = userEvent.setup();
    renderTrip();
    await user.click(await screen.findByRole("button", { name: "Travel" }));
    await user.click(within(day("2026-05-14")).getByRole("button"));
    const dialog = screen.getByRole("dialog", { name: "Zürich → Chicago" });
    expect(within(dialog).queryByLabelText("From")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Flight")).toBeInTheDocument();
  });

  it("opens the edit form from the quick look's Edit button", async () => {
    const user = userEvent.setup();
    renderTrip();
    await user.click(await screen.findByRole("button", { name: "Travel" }));
    await user.click(within(day("2026-05-14")).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit travel" });
    expect(within(dialog).getByLabelText("From")).toHaveValue("Zürich Airport (ZRH)");
  });
});

describe("adding a stay from the stays coverage view", () => {
  // The sample trip's stays cover May 11-13; May 10 has none.
  async function openAddStay(user) {
    await user.click(await screen.findByRole("button", { name: "Stays" }));
    await user.click(within(day("2026-05-10")).getByRole("button"));
    return screen.getByRole("dialog", { name: "Add stay" });
  }

  it("prefills check-in/out from the selected date, requiring where it is", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: readTrip() });
    renderTrip();
    const dialog = await openAddStay(user);

    expect(within(dialog).getByLabelText("Check-in date")).toHaveValue("2026-05-10");
    expect(within(dialog).getByLabelText("Check-in time")).toHaveValue("15:00");
    expect(within(dialog).getByLabelText("Check-out date")).toHaveValue("2026-05-11");
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
        checkIn: "2026-05-10T15:00",
        checkOut: "2026-05-11T11:00",
        location: {
          placeId: "bel",
          name: "Hotel Bellevue Palace",
          address: "Kochergasse 3-5, Bern",
          lat: 46.9466,
          lng: 7.4442,
          imgRef: "https://places.googleapis.com/v1/places/bel/photos/abc/media",
        },
        roomType: "Junior suite",
      },
      { silent: true }
    );
  });

  it("checks check-out is after check-in", async () => {
    const user = userEvent.setup();
    renderTrip();
    const dialog = await openAddStay(user);
    await pickPlace(user, dialog, "Where", "bell", "Hotel Bellevue Palace");
    await user.clear(within(dialog).getByLabelText("Check-out date"));
    await user.type(within(dialog).getByLabelText("Check-out date"), "2026-05-10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Check-out must be after check-in")).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("falls back to a typed name when search is unavailable", async () => {
    const user = userEvent.setup();
    createPlacesSearch.mockRejectedValue(new Error("no key"));
    renderTrip();
    const dialog = await openAddStay(user);

    await user.type(within(dialog).getByRole("combobox", { name: "Where" }), "Gasthaus Sonne");
    expect(await within(dialog).findByText("Place search is unavailable.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Use “Gasthaus Sonne” as typed" }));
    expect(within(dialog).getByText("Not on the map, so times use Zurich time")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Where")).toHaveValue("Gasthaus Sonne");
  });
});

describe("opening a stay from the stays coverage view", () => {
  it("shows a read-only quick look first, not the edit form", async () => {
    const user = userEvent.setup();
    renderTrip();
    await user.click(await screen.findByRole("button", { name: "Stays" }));
    await user.click(within(day("2026-05-11")).getByRole("button"));
    const dialog = screen.getByRole("dialog", { name: "Hotel Goldener Schlüssel" });
    expect(within(dialog).queryByLabelText("Name")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Check-in")).toBeInTheDocument();
  });

  it("opens the edit form from the quick look's Edit button", async () => {
    const user = userEvent.setup();
    renderTrip();
    await user.click(await screen.findByRole("button", { name: "Stays" }));
    await user.click(within(day("2026-05-11")).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit stay" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Hotel Goldener Schlüssel");
  });
});
