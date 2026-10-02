import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { formatDayHeading } from "@/shared/utils/time";
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
          <Route
            path="/trips/:tripId"
            element={<TripTimelinePage />}
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

/** The button that opens and closes a date's card. */
function dayToggle(date) {
  return within(day(date)).getByRole("button", { name: new RegExp(`^${formatDayHeading(date)}`) });
}

describe("TripTimelinePage", () => {
  it("lists every date on the timeline, each day collapsed", async () => {
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
    expect(screen.queryByRole("list", { name: /^Plans for/ })).not.toBeInTheDocument();
    expect(dayToggle("2026-05-10")).toHaveAttribute("aria-expanded", "false");
    expect(apiClient.get).toHaveBeenCalledWith("/trips/trip-1", { silent: true });
  });

  it("rows a day as its date and cities, then its title and summary", async () => {
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(dayToggle("2026-05-12")).toHaveTextContent("Tue, May 12Bern → Wengen");
    expect(within(day("2026-05-12")).getByRole("heading", { name: "Tue, May 12" })).toBeInTheDocument();
    expect(day("2026-05-12")).toHaveTextContent(
      "Up to Wengen — A slow morning in Bern, then the train into the mountains."
    );
    expect(within(day("2026-05-12")).getByText("Up to Wengen").tagName).toBe("STRONG");
    // No title or summary: just the date and cities.
    expect(day("2026-05-10")).toHaveTextContent(/^Sun, May 10Chicago → Zürich$/);
  });

  it("opens a day on tap to show its entries, merged by time", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    await user.click(dayToggle("2026-05-11"));
    expect(dayToggle("2026-05-11")).toHaveAttribute("aria-expanded", "true");
    const texts = entryTexts("2026-05-11");
    expect(texts[0]).toContain("Arrive · Zürich Airport (ZRH)");
    expect(texts[2]).toContain("Lunch at Altes Tramdepot");
    expect(texts[4]).toContain("Check in · Hotel Goldener Schlüssel");
  });

  it("opens a day from a tap on its summary, and leaves other days open", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    await user.click(dayToggle("2026-05-12"));
    await user.click(within(day("2026-05-13")).getByText(/The big hiking day/));
    expect(screen.getByText("Fondue night")).toBeInTheDocument();
    expect(dayToggle("2026-05-12")).toHaveAttribute("aria-expanded", "true");
    await user.click(dayToggle("2026-05-13"));
    expect(screen.queryByText("Fondue night")).not.toBeInTheDocument();
  });

  it("says when an opened day has nothing planned", async () => {
    const user = userEvent.setup();
    const trip = structuredClone(TRIP);
    trip.travels = trip.travels.slice(1); // nothing left on May 10
    apiClient.get.mockResolvedValue({ data: trip });
    renderPage();
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(day("2026-05-10")).toHaveTextContent(/^Sun, May 10$/);
    await user.click(dayToggle("2026-05-10"));
    expect(within(day("2026-05-10")).getByText("Nothing planned for this day.")).toBeInTheDocument();
  });

  it("opens and scrolls to the day named in the URL", async () => {
    renderPage("/trips/trip-1?day=2026-05-12");
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(scrolled).toContain("day-2026-05-12");
    expect(dayToggle("2026-05-12")).toHaveAttribute("aria-expanded", "true");
    expect(dayToggle("2026-05-11")).toHaveAttribute("aria-expanded", "false");
  });

  it("ignores an unknown date in the URL", async () => {
    renderPage("/trips/trip-1?day=1999-01-01");
    await screen.findByRole("heading", { name: TRIP.name, level: 1 });
    expect(scrolled.filter((id) => id?.startsWith("day-"))).toEqual([]);
    expect(screen.queryByRole("list", { name: /^Plans for/ })).not.toBeInTheDocument();
  });

  it("expands an entry to markdown notes, map link and confirmation", async () => {
    const user = userEvent.setup();
    renderPage("/trips/trip-1?day=2026-05-11");
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
    renderPage("/trips/trip-1?day=2026-05-10");
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
