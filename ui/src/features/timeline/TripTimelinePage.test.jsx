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

function renderPage(url = "/trips/trip-1") {
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
        initialEntries={[url]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
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

/** The link that opens a date's own page. */
function dayLink(date) {
  return within(day(date)).getByRole("link");
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: TRIP });
});

describe("TripTimelinePage", () => {
  it("lists every date on the timeline, each a link to its own page", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: TRIP.name, level: 1 })).toBeInTheDocument();
    const days = within(screen.getByRole("list", { name: "Trip days" })).getAllByRole("listitem");
    expect(days.map((li) => li.id)).toEqual([
      "day-2026-05-10",
      "day-2026-05-11",
      "day-2026-05-12",
      "day-2026-05-13",
      "day-2026-05-14",
    ]);
    expect(dayLink("2026-05-10")).toHaveAttribute("href", "/trips/trip-1/days/2026-05-10");
    expect(apiClient.get).toHaveBeenCalledWith("/trips/trip-1", { silent: true });
  });

  it("rows a day as its date and cities, then its title and summary", async () => {
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(day("2026-05-12")).toHaveTextContent("Tue, May 12Bern → Wengen");
    expect(within(day("2026-05-12")).getByRole("heading", { name: "Tue, May 12" })).toBeInTheDocument();
    expect(day("2026-05-12")).toHaveTextContent(
      "Up to Wengen — A slow morning in Bern, then the train into the mountains."
    );
    expect(within(day("2026-05-12")).getByText("Up to Wengen").tagName).toBe("STRONG");
    // No title or summary: just the date and cities.
    expect(day("2026-05-10")).toHaveTextContent(/^Sun, May 10Chicago → Zürich$/);
  });

  it("navigates to the day page on tap", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    await user.click(dayLink("2026-05-11"));
    expect(await screen.findByText("day page")).toBeInTheDocument();
  });

  it("shows a not-found state for a missing trip", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByText("Trip not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to trips" })).toHaveAttribute("href", "/");
  });

  it("switches to the stays view and back, and never shows both at once", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    const stays = screen.getByRole("button", { name: "Show which nights have a stay" });
    const travel = screen.getByRole("button", { name: "Show which days have travel" });
    expect(stays).toHaveAttribute("aria-pressed", "false");

    await user.click(stays);
    expect(stays).toHaveAttribute("aria-pressed", "true");
    expect(day("2026-05-11")).toHaveTextContent("Mon, May 11Hotel Goldener Schlüssel");
    expect(day("2026-05-12")).toHaveTextContent("Tue, May 12Beausite Park Hotel");
    expect(day("2026-05-10")).toHaveTextContent(/^Sun, May 10$/); // flying overnight, no stay yet

    // Switching to travel leaves stays view, never shows both.
    await user.click(travel);
    expect(stays).toHaveAttribute("aria-pressed", "false");
    expect(travel).toHaveAttribute("aria-pressed", "true");
    expect(day("2026-05-10")).toHaveTextContent("Sun, May 10Chicago → Zürich");

    // Clicking the active view's own button returns to plan.
    await user.click(travel);
    expect(travel).toHaveAttribute("aria-pressed", "false");
    expect(day("2026-05-12")).toHaveTextContent("Tue, May 12Bern → Wengen");
  });
});
