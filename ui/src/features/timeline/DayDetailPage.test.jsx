import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { Link, MemoryRouter, Routes, Route, useLocation, useNavigationType } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { DayDetailPage } from "@/features/timeline/DayDetailPage";
import { apiClient } from "@/shared/services/apiClient";
import { fakeEmbla } from "@/test/fakeEmbla";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z" };

// Where the router is, and how it got there; plus a link from outside the
// day swiper, like the timeline's or search's.
const where = { path: null, type: null };
function LocationProbe() {
  where.path = useLocation().pathname;
  where.type = useNavigationType();
  return <Link to="/trips/trip-1/days/2026-05-14">Elsewhere: Thu</Link>;
}

function renderDay(date, tripId = "trip-1", { from } = {}) {
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
        initialEntries={[from, `/trips/${tripId}/days/${date}`].filter(Boolean)}
        initialIndex={from ? 1 : 0}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/trips/:tripId/days/:date" element={<DayDetailPage />} />
        </Routes>
        <LocationProbe />
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
  it("has ← in ☰'s place: opened directly, it goes to the whole timeline", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    await screen.findByRole("heading", { name: "Mon, May 11" });
    const bar = screen.getByRole("button", { name: "Back" }).closest("header");
    expect(within(bar).getAllByRole("button")[0]).toHaveAccessibleName("Back");
    expect(within(bar).queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(where.path).toBe("/trips/trip-1");
  });

  it("opened directly and swiped to another day, ← still goes to the timeline", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    await screen.findByRole("heading", { name: "Mon, May 11" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(where.path).toBe("/trips/trip-1/days/2026-05-12"));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(where.path).toBe("/trips/trip-1");
  });

  it("← goes back where you came from", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11", "trip-1", { from: "/trips/trip-1/today" });
    await screen.findByRole("heading", { name: "Mon, May 11" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(where.path).toBe("/trips/trip-1/today");
  });

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

  it("a row is a link to its entry's page (the check-in opens its stay)", async () => {
    renderDay("2026-05-11");
    const checkIn = await screen.findByRole("link", { name: /Check in · Hotel Goldener/ });
    expect(checkIn).toHaveAttribute("href", expect.stringMatching(/^\/trips\/trip-1\/stays\//));
    // Nothing expands in place any more.
    expect(screen.queryByText("SAMPLE-1001")).not.toBeInTheDocument();
  });

  it("labels times outside the trip's timezone", async () => {
    renderDay("2026-05-10");
    await screen.findByRole("heading", { name: "Sun, May 10" });
    expect(screen.getByText("5:40 PM")).toBeInTheDocument();
    expect(screen.getByText("Chicago")).toBeInTheDocument();
  });

  it("opens on the URL's day; only it and its neighbours render, and there are no prev/next links", async () => {
    renderDay("2026-05-12");
    await screen.findByRole("heading", { name: "Tue, May 12" });
    expect(screen.getByText("Day 3 of 5")).toBeInTheDocument();
    expect(fakeEmbla.api.selectedScrollSnap()).toBe(2);
    // The neighbours are there for the swipe, but hidden from the reader.
    const all = screen.getAllByRole("heading", { level: 1, hidden: true }).map((h) => h.textContent);
    expect(all).toEqual(["Mon, May 11", "Tue, May 12", "Wed, May 13"]);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Tue, May 12"]);
    expect(screen.getByRole("heading", { name: "Tue, May 12" }).closest("[inert]")).toBeNull();
    expect(screen.getByRole("heading", { name: "Mon, May 11", hidden: true }).closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("link", { name: /May 11|May 13/ })).not.toBeInTheDocument();
  });

  it("settling on another day replaces the URL, so Back isn't every day swiped past", async () => {
    renderDay("2026-05-12");
    await screen.findByRole("heading", { name: "Tue, May 12" });
    act(() => fakeEmbla.api.scrollNext());
    expect(await screen.findByRole("heading", { name: "Wed, May 13" })).toBeInTheDocument();
    expect(where).toEqual({ path: "/trips/trip-1/days/2026-05-13", type: "REPLACE" });
    act(() => fakeEmbla.api.scrollPrev());
    expect(await screen.findByRole("heading", { name: "Tue, May 12" })).toBeInTheDocument();
    expect(where.path).toBe("/trips/trip-1/days/2026-05-12");
  });

  it("a day picked elsewhere jumps straight there", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    await screen.findByRole("heading", { name: "Mon, May 11" });
    await user.click(screen.getByRole("link", { name: "Elsewhere: Thu" }));
    expect(await screen.findByRole("heading", { name: "Thu, May 14" })).toBeInTheDocument();
    expect(fakeEmbla.api.selectedScrollSnap()).toBe(4);
    expect(fakeEmbla.api.lastJump).toBe(true); // no animation
    expect(where.type).toBe("PUSH"); // the swiper didn't navigate again
  });

  it("the arrow keys change the day, but not while typing or in a dialog", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-12");
    await screen.findByRole("heading", { name: "Tue, May 12" });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "Wed, May 13" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(await screen.findByRole("heading", { name: "Tue, May 12" })).toBeInTheDocument();

    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { key: "ArrowRight" });
    input.remove();
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    expect(fakeEmbla.api.selectedScrollSnap()).toBe(2);

    await user.click(screen.getByRole("button", { name: "Edit Tue, May 12 title and summary" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(fakeEmbla.api.selectedScrollSnap()).toBe(2);
  });

  it("has no separate back link: the top bar and Timeline tab cover it", async () => {
    renderDay("2026-05-12");
    await screen.findByRole("heading", { name: "Tue, May 12" });
    expect(screen.queryByRole("link", { name: "Trip" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "Back to trips" })).toHaveAttribute("href", "/trips");
  });
});
