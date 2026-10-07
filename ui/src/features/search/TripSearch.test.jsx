import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { tripRoutes } from "@/test/tripRoutes";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z" };
TRIP.travels.forEach((t, i) => (t.id = `travel-${i}`));

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
        <Routes>{tripRoutes()}</Routes>
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: TRIP });
});

describe("trip search", () => {
  it("opens from the top bar, groups results by day, and opens the entry's page", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1");
    await user.click(await screen.findByRole("button", { name: "Search this trip" }));
    const dialog = screen.getByRole("dialog", { name: `Search ${TRIP.name}` });
    await user.type(within(dialog).getByRole("searchbox", { name: "Search this trip" }), "SBB");

    const day = within(dialog).getByRole("region", { name: "Sun, May 10" });
    const result = within(day).getByRole("link", { name: /Chicago → Zürich/ });
    expect(result).toHaveTextContent(/Notes: .*SBB/);
    await user.click(result);

    // The flight's own page.
    expect(await screen.findByRole("article", { name: "Chicago → Zürich" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1");
    await user.click(await screen.findByRole("button", { name: "Search this trip" }));
    await user.type(screen.getByRole("searchbox", { name: "Search this trip" }), "qwerty");
    expect(screen.getByText("Nothing on this trip matches “qwerty”.")).toBeInTheDocument();
  });

  it("an older ?open= link goes on to that entry's page", async () => {
    renderAt("/trips/trip-1/days/2026-05-11?open=travel-1-dep");
    expect(await screen.findByRole("article", { name: "Zürich Airport → Bern" })).toBeInTheDocument();
  });
});
