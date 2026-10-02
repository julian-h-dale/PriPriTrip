import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

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
          <Route
            path="/trips/:tripId"
            element={
              <>
                <TripTimelinePage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

/** The timeline card (list item) for a date. */
function day(date) {
  return document.getElementById(`day-${date}`);
}

function entryTexts(date) {
  return within(within(day(date)).getByRole("list", { name: /^Plans for/ }))
    .getAllByRole("listitem")
    .filter((li) => li.parentElement.getAttribute("aria-label")?.startsWith("Plans for"))
    .map((li) => li.textContent);
}

const scrolled = [];

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: TRIP });
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView() {
    scrolled.push(this.id || this.getAttribute("aria-label"));
  };
});

afterEach(() => {
  delete Element.prototype.scrollIntoView;
});

describe("TripTimelinePage", () => {
  it("lists every date on the timeline, each day's card open", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: TRIP.name, level: 1 })).toBeInTheDocument();
    const days = within(screen.getByRole("list", { name: "Trip days" })).getAllByRole("listitem", {
      name: "",
    });
    expect(days.filter((li) => li.id.startsWith("day-")).map((li) => li.id)).toEqual([
      "day-2026-05-10",
      "day-2026-05-11",
      "day-2026-05-12",
      "day-2026-05-13",
      "day-2026-05-14",
    ]);
    // Open by default: entries are visible without a tap.
    expect(screen.getByText("Lunch at Altes Tramdepot")).toBeInTheDocument();
    expect(screen.getByText("Fondue night")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/trips/trip-1", { silent: true });
  });

  it("heads each card with the day's title, or its date when untitled", async () => {
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(within(day("2026-05-11")).getByRole("heading", { name: "Arrive in Bern" })).toBeInTheDocument();
    expect(within(day("2026-05-11")).getByText("Mon, May 11 · Day 2")).toBeInTheDocument();
    expect(within(day("2026-05-10")).getByRole("heading", { name: "Sun, May 10" })).toBeInTheDocument();
  });

  it("merges markers by time around activities", async () => {
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    const texts = entryTexts("2026-05-11");
    expect(texts[0]).toContain("Arrive · Zürich Airport (ZRH)");
    expect(texts[2]).toContain("Lunch at Altes Tramdepot");
    expect(texts[4]).toContain("Check in · Hotel Goldener Schlüssel");
  });

  it("collapses and reopens a day", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    const toggle = within(day("2026-05-13")).getByRole("button", { name: /Männlichen ridge/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Fondue night")).not.toBeInTheDocument();
    expect(within(day("2026-05-13")).getByText("4 entries")).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("Fondue night")).toBeInTheDocument();
  });

  it("shows a date with nothing on it as a slim point", async () => {
    const trip = structuredClone(TRIP);
    trip.travels = trip.travels.slice(1); // nothing left on May 10
    apiClient.get.mockResolvedValue({ data: trip });
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(day("2026-05-10")).toHaveTextContent("Sun, May 10 · Day 1 · No plans");
    expect(within(day("2026-05-10")).queryByRole("list", { name: /^Plans for/ })).not.toBeInTheDocument();
  });

  it("jumps to a day from the date strip and keeps it in the URL", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Jump to Wed, May 13" }));
    expect(scrolled).toContain("day-2026-05-13");
    expect(screen.getByRole("button", { name: "Jump to Wed, May 13" })).toHaveAttribute(
      "aria-current",
      "true"
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/trips/trip-1?day=2026-05-13");
  });

  it("scrolls to the day named in the URL", async () => {
    renderPage("/trips/trip-1?day=2026-05-12");
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(scrolled).toContain("day-2026-05-12");
    expect(screen.getByRole("button", { name: "Jump to Tue, May 12" })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("ignores an unknown date in the URL", async () => {
    renderPage("/trips/trip-1?day=1999-01-01");
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(scrolled.filter((id) => id?.startsWith("day-"))).toEqual([]);
    expect(screen.getByRole("button", { name: "Jump to Sun, May 10" })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("expands an entry to markdown notes, map link and confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
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
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(within(day("2026-05-10")).getByText("5:40 PM")).toBeInTheDocument();
    expect(within(day("2026-05-10")).getByText("Chicago")).toBeInTheDocument();
  });

  it("shows a not-found state for a missing trip", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByText("Trip not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to trips" })).toHaveAttribute("href", "/");
  });
});
