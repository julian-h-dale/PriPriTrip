import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
import { DayDetailPage } from "@/features/timeline/DayDetailPage";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
import { TripsPage } from "@/features/trips/TripsPage";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const TRIP_ID = "3f2b8c1e-1111-4222-8333-444455556666";
const base = { ...structuredClone(sampleTrip), id: TRIP_ID, createdAt: "2026-10-02T05:00:00Z" };
const asOwner = { ...base, role: "owner" };
const asViewer = { ...base, role: "viewer" };
const summary = (role) => ({
  id: TRIP_ID,
  name: base.name,
  startDate: "2099-05-10",
  endDate: "2099-05-14",
  timezone: base.timezone,
  stayCount: 2,
  travelCount: 4,
  createdAt: base.createdAt,
  role,
});

function renderAt(path) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      trips: tripsReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: "t", user: { email: "u@x.com", is_superuser: false }, status: "idle" } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
          <Route path="/trips/:tripId/today" element={<div>today page</div>} />
          <Route path="/trips/:tripId/days/:date" element={<DayDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(() => vi.clearAllMocks());

describe("a viewer", () => {
  it("sees a day with no edit controls at all", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: asViewer });
    renderAt(`/trips/${TRIP_ID}/days/2026-05-11`);
    await screen.findByRole("heading", { name: "Mon, May 11" });
    expect(screen.queryByRole("button", { name: /Add activity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /title and summary/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Lunch at Altes Tramdepot/ }));
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
  });

  it("gets a quick look with no Edit, and no Share button", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: asViewer });
    renderAt(`/trips/${TRIP_ID}`);
    await screen.findByRole("heading", { name: base.name, level: 1 });
    expect(screen.queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stays" }));
    await user.click(document.querySelector("#day-2026-05-11 button"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

describe("the owner", () => {
  it("shares the trip id and removes a viewer (with a second tap to confirm)", async () => {
    const user = userEvent.setup();
    apiClient.get.mockImplementation(async (url) =>
      url.endsWith("/members")
        ? { data: [{ userId: "v1", email: "pripri@example.com", role: "viewer", joinedAt: "2026-10-03T00:00:00Z" }] }
        : { data: asOwner }
    );
    apiClient.delete.mockResolvedValue({});
    renderAt(`/trips/${TRIP_ID}`);
    await user.click(await screen.findByRole("button", { name: "Share trip" }));
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    expect(within(dialog).getByText(TRIP_ID)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy trip id" })).toBeInTheDocument();

    await user.click(await within(dialog).findByRole("button", { name: "Remove pripri@example.com" }));
    expect(apiClient.delete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm removing pripri@example.com" }));
    expect(apiClient.delete).toHaveBeenCalledWith(`/trips/${TRIP_ID}/members/v1`, { silent: true });
    expect(within(dialog).getByText("No one yet.")).toBeInTheDocument();
  });
});

describe("joining and leaving from the trips list", () => {
  it("checks the id looks right, then joins and opens the trip", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [] });
    apiClient.post.mockResolvedValue({ data: summary("viewer") });
    renderAt("/trips");
    await user.click(await screen.findByRole("button", { name: "Join trip" }));
    const dialog = screen.getByRole("dialog", { name: "Join a trip" });
    const input = within(dialog).getByLabelText("Trip id");

    await user.type(input, "not an id");
    await user.click(within(dialog).getByRole("button", { name: "Join" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("doesn’t look like a trip id");
    expect(apiClient.post).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, `  ${TRIP_ID} `);
    await user.click(within(dialog).getByRole("button", { name: "Join" }));
    expect(apiClient.post).toHaveBeenCalledWith("/trips/join", { tripId: TRIP_ID }, { silent: true });
    expect(await screen.findByText("today page")).toBeInTheDocument();
  });

  it("says when no trip has that id", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [] });
    apiClient.post.mockRejectedValue({ response: { status: 404 } });
    renderAt("/trips");
    await user.click(await screen.findByRole("button", { name: "Join trip" }));
    await user.type(screen.getByLabelText("Trip id"), TRIP_ID);
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No trip has that id");
  });

  it("marks a shared trip and offers Leave (not Delete)", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [summary("viewer")] });
    apiClient.delete.mockResolvedValue({});
    renderAt("/trips");
    expect(await screen.findByText("Shared with you")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `More for ${base.name}` }));
    expect(screen.queryByRole("menuitem", { name: "Delete trip" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Leave trip" }));
    await user.click(within(screen.getByRole("dialog", { name: "Leave trip?" })).getByRole("button", { name: "Leave" }));
    expect(apiClient.delete).toHaveBeenCalledWith(`/trips/${TRIP_ID}/membership`, { silent: true });
    await vi.waitFor(() => expect(screen.queryByText(base.name)).not.toBeInTheDocument());
  });
});
