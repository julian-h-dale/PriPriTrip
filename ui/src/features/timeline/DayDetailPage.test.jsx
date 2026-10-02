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
import { DayDetailPage } from "@/features/timeline/DayDetailPage";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z" };

function renderDay(date, tripId = "trip-1") {
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
        initialEntries={[`/trips/${tripId}/days/${date}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/trips/:tripId/days/:date" element={<DayDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

function entries() {
  return within(screen.getByRole("list", { name: /^Plans for/ })).getAllByRole("listitem").map((li) => li.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: TRIP });
});

describe("DayDetailPage", () => {
  it("shows a day's entries, merged by time", async () => {
    renderDay("2026-05-11");
    await screen.findByRole("heading", { name: "Mon, May 11" });
    const texts = entries();
    expect(texts[0]).toContain("Arrive · Zürich Airport (ZRH)");
    expect(texts[2]).toContain("Lunch at Altes Tramdepot");
    expect(texts[4]).toContain("Check in · Hotel Goldener Schlüssel");
  });

  it("says when a day has nothing planned", async () => {
    const trip = structuredClone(TRIP);
    trip.travels = trip.travels.slice(1); // nothing left on May 10
    apiClient.get.mockResolvedValue({ data: trip });
    renderDay("2026-05-10");
    expect(await screen.findByText("Nothing planned for this day.")).toBeInTheDocument();
  });

  it("expands an entry to markdown notes, map link and confirmation", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    await user.click(await screen.findByRole("button", { name: /Check in · Hotel Goldener/ }));

    const bold = screen.getByText("drop bags");
    expect(bold.tagName).toBe("STRONG");
    expect(screen.getByText("SAMPLE-1001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open map" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=46.9486227,7.4487269"
    );
    await user.click(screen.getByRole("button", { name: /Check in · Hotel Goldener/ }));
    expect(screen.queryByText("SAMPLE-1001")).not.toBeInTheDocument();
  });

  it("labels times outside the trip's timezone", async () => {
    renderDay("2026-05-10");
    await screen.findByRole("heading", { name: "Sun, May 10" });
    expect(screen.getByText("5:40 PM")).toBeInTheDocument();
    expect(screen.getByText("Chicago")).toBeInTheDocument();
  });

  it("links to the adjacent days and not past the ends of the trip", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-12");
    await screen.findByRole("heading", { name: "Tue, May 12" });
    expect(screen.getByRole("link", { name: /Mon, May 11/ })).toHaveAttribute(
      "href",
      "/trips/trip-1/days/2026-05-11"
    );
    await user.click(screen.getByRole("link", { name: /Wed, May 13/ }));
    expect(await screen.findByRole("heading", { name: "Wed, May 13" })).toBeInTheDocument();
  });

  it("shows a fallback for a date outside the trip", async () => {
    renderDay("1999-01-01");
    expect(await screen.findByText("No such day")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to trip" })).toHaveAttribute("href", "/trips/trip-1");
  });

  it("shows a not-found state for a missing trip", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    renderDay("2026-05-11");
    expect(await screen.findByText("Trip not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to trips" })).toHaveAttribute("href", "/");
  });
});
