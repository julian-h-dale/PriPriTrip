import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { LandingPage } from "@/features/trips/LandingPage";
import { TopBar } from "@/shared/components/TopBar";
import { apiClient } from "@/shared/services/apiClient";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const summary = (id, startDate, endDate) => ({ id, name: id, startDate, endDate, timezone: "UTC", stayCount: 0, travelCount: 0 });

function renderAt(path, element) {
  const store = configureStore({
    reducer: { auth: authReducer, trips: tripsReducer, error: errorReducer, notification: notificationReducer },
    preloadedState: { auth: { token: "t", user: { email: "u@x.com", is_superuser: false }, status: "idle" } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={element} />
          <Route path="/trips" element={<div>all trips</div>} />
          <Route path="/trips/:tripId/today" element={<div>trip page</div>} />
          <Route path="/trips/:tripId" element={<div>the trip timeline</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(() => vi.clearAllMocks());

describe("LandingPage", () => {
  it("opens the next upcoming trip, skipping past ones", async () => {
    apiClient.get.mockResolvedValue({
      data: [summary("old", "2001-01-01", "2001-01-02"), summary("next", "2099-01-01", "2099-01-05")],
    });
    renderAt("/", <LandingPage />);
    expect(await screen.findByText("trip page")).toBeInTheDocument();
  });

  it("a viewer lands on the trip's timeline: they have no Today tab", async () => {
    apiClient.get.mockResolvedValue({ data: [{ ...summary("next", "2099-01-01", "2099-01-05"), role: "viewer" }] });
    renderAt("/", <LandingPage />);
    expect(await screen.findByText("the trip timeline")).toBeInTheDocument();
  });

  it("falls back to the trips list when nothing is active or upcoming", async () => {
    apiClient.get.mockResolvedValue({ data: [summary("old", "2001-01-01", "2001-01-02")] });
    renderAt("/", <LandingPage />);
    expect(await screen.findByText("all trips")).toBeInTheDocument();
  });

  it("falls back to the trips list when the trips can't load at all", async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error("Network Error"), { config: {} }));
    renderAt("/", <LandingPage />);
    expect(await screen.findByText("all trips")).toBeInTheDocument();
  });
});

describe("nav drawer", () => {
  it("opens from ☰ with All trips and Sign out, and closes on Escape", async () => {
    renderAt("/", <TopBar title="Trip" />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("navigation", { name: "Menu" });
    expect(screen.getByRole("link", { name: "All trips" })).toHaveAttribute("href", "/trips");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(menu).not.toBeInTheDocument();
  });

  it("Sign out signs out", async () => {
    const store = renderAt("/", <TopBar title="Trip" />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => expect(store.getState().auth.token).toBeNull());
  });
});
