import { describe, it, expect, vi, beforeEach } from "vitest";
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

function tab(name) {
  return screen.getByRole("tab", { name: new RegExp(name) });
}

function panel() {
  return screen.getByRole("tabpanel");
}

function entryTexts() {
  return within(panel())
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

describe("TripTimelinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: TRIP });
  });

  it("shows one tab per date with the first day selected", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: TRIP.name, level: 1 })).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist", { name: "Trip days" })).getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(panel()).toHaveAttribute("aria-labelledby", tabs[0].id);
    expect(apiClient.get).toHaveBeenCalledWith("/trips/trip-1", { silent: true });
  });

  it("heads a date with no day entry by its date", async () => {
    renderPage();
    const day = await screen.findByRole("tabpanel");
    expect(within(day).getByRole("heading", { name: "Sun, May 10" })).toBeInTheDocument();
    expect(within(day).getByText("Day 1")).toBeInTheDocument();
  });

  it("switches days by tab and keeps the day in the URL", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: /May 11/ }));

    expect(tab("May 11")).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByRole("heading", { name: "Arrive in Bern" })).toBeInTheDocument();
    expect(within(panel()).getByText(/keep the afternoon easy/)).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/trips/trip-1?day=2026-05-11");

    const texts = entryTexts();
    expect(texts[0]).toContain("Arrive · Zürich Airport (ZRH)");
    expect(texts[2]).toContain("Lunch at Altes Tramdepot");
    expect(texts[4]).toContain("Check in · Hotel Goldener Schlüssel");
  });

  it("opens the day named in the URL", async () => {
    renderPage("/trips/trip-1?day=2026-05-13");
    expect(await screen.findByRole("heading", { name: "Männlichen ridge" })).toBeInTheDocument();
    expect(tab("May 13")).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to the first day for an unknown date", async () => {
    renderPage("/trips/trip-1?day=1999-01-01");
    expect(await screen.findByRole("tab", { name: /May 10/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("moves between days with arrow keys and the prev/next buttons", async () => {
    const user = userEvent.setup();
    renderPage();
    (await screen.findByRole("tab", { name: /May 10/ })).focus();
    await user.keyboard("{ArrowRight}");
    expect(tab("May 11")).toHaveAttribute("aria-selected", "true");
    expect(tab("May 11")).toHaveFocus();
    await user.keyboard("{End}");
    expect(tab("May 14")).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: /Wed, May 13/ }));
    expect(tab("May 13")).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: /Thu, May 14/ }));
    expect(tab("May 14")).toHaveAttribute("aria-selected", "true");
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
    expect(screen.getByRole("button", { name: "Copy confirmation number" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Check in · Hotel Goldener/ }));
    expect(screen.queryByText("SAMPLE-1001")).not.toBeInTheDocument();
  });

  it("labels times outside the trip's timezone", async () => {
    renderPage();
    const day = await screen.findByRole("tabpanel");
    expect(within(day).getByText("5:40 PM")).toBeInTheDocument();
    expect(within(day).getByText("Chicago")).toBeInTheDocument();
  });

  it("shows a not-found state for a missing trip", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByText("Trip not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to trips" })).toHaveAttribute("href", "/");
  });
});
