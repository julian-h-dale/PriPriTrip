import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { DayDetailPage } from "@/features/timeline/DayDetailPage";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z" };

function renderAt(path) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
          <Route path="/trips/:tripId/days/:date" element={<DayDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: TRIP });
});

describe("trip search", () => {
  it("opens from the top bar, groups results by day, and opens the entry on its day", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1");
    await user.click(await screen.findByRole("button", { name: "Search this trip" }));
    const dialog = screen.getByRole("dialog", { name: `Search ${TRIP.name}` });
    await user.type(within(dialog).getByRole("searchbox", { name: "Search this trip" }), "SBB");

    const day = within(dialog).getByRole("region", { name: "Sun, May 10" });
    const result = within(day).getByRole("link", { name: /Chicago → Zürich/ });
    expect(result).toHaveTextContent(/Notes: .*SBB/);
    await user.click(result);

    // The day page, with that entry already expanded.
    expect(await screen.findByRole("heading", { name: "Sun, May 10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Chicago → Zürich/, expanded: true })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1");
    await user.click(await screen.findByRole("button", { name: "Search this trip" }));
    await user.type(screen.getByRole("searchbox", { name: "Search this trip" }), "qwerty");
    expect(screen.getByText("Nothing on this trip matches “qwerty”.")).toBeInTheDocument();
  });

  it("?open= expands that entry on arrival", async () => {
    renderAt("/trips/trip-1/days/2026-05-11?open=travel-1-dep");
    expect(await screen.findByRole("button", { name: /Zürich Airport → Bern/, expanded: true })).toBeInTheDocument();
  });
});
