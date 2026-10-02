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
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

// The API's read shape: the document plus ids.
const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z" };

function renderPage() {
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
        initialEntries={["/trips/trip-1"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

function dayButton(name) {
  return screen.getByRole("button", { name: new RegExp(name) });
}

describe("TripTimelinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: TRIP });
  });

  it("shows every date collapsed by default", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: TRIP.name, level: 1 })).toBeInTheDocument();
    const days = within(screen.getByRole("list", { name: "Trip days" })).getAllByRole("button");
    expect(days).toHaveLength(5);
    days.forEach((b) => expect(b).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByText("Lunch at Altes Tramdepot")).not.toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/trips/trip-1", { silent: true });
  });

  it("titles a date with no day entry by what happens on it", async () => {
    renderPage();
    expect(await screen.findByText("Chicago → Zürich")).toBeInTheDocument();
  });

  it("expands a day to its summary and entries in order", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Arrive in Bern/ }));
    expect(dayButton("Arrive in Bern")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/keep the afternoon easy/)).toBeInTheDocument();

    const panel = document.getElementById("day-2026-05-11");
    const titles = within(panel)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(titles[0]).toContain("Arrive · Zürich Airport (ZRH)");
    expect(titles[2]).toContain("Lunch at Altes Tramdepot");
    expect(titles[4]).toContain("Check in · Hotel Goldener Schlüssel");

    await user.click(dayButton("Arrive in Bern"));
    expect(screen.queryByText("Lunch at Altes Tramdepot")).not.toBeInTheDocument();
  });

  it("expands an entry to markdown notes, map link and confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Arrive in Bern/ }));
    await user.click(screen.getByRole("button", { name: /Check in · Hotel Goldener/ }));

    const bold = screen.getByText("drop bags");
    expect(bold.tagName).toBe("STRONG");
    expect(screen.getByText("SAMPLE-1001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open map" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=46.9486227,7.4487269"
    );
    expect(screen.getByRole("button", { name: "Copy confirmation number" })).toBeInTheDocument();
  });

  it("labels times outside the trip's timezone", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Chicago → Zürich/ }));
    const panel = document.getElementById("day-2026-05-10");
    expect(within(panel).getByText("5:40 PM")).toBeInTheDocument();
    expect(within(panel).getByText("Chicago")).toBeInTheDocument();
  });

  it("expands and collapses every day at once", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Fondue night")).toBeInTheDocument();
    expect(screen.getByText("Lunch at Altes Tramdepot")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("Fondue night")).not.toBeInTheDocument();
  });

  it("shows a not-found state for a missing trip", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByText("Trip not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to trips" })).toHaveAttribute("href", "/");
  });
});
