import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { EntryPage } from "@/features/entry/EntryPage";
import { PULL_THRESHOLD_PX, pullDirection, pullOffset } from "@/features/entry/useEdgePull";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import { TRIP } from "@/test/sampleTrip";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("which way a pull goes", () => {
  const page = { scrollHeight: 2000, clientHeight: 600, hasPrev: true, hasNext: true };

  it("at the top, pulling down is Previous; at the bottom, pulling up is Next", () => {
    expect(pullDirection({ ...page, dy: 5, scrollTop: 0 })).toBe("prev");
    expect(pullDirection({ ...page, dy: -5, scrollTop: 1400 })).toBe("next");
  });

  it("anywhere else, or the other way, it's a scroll", () => {
    expect(pullDirection({ ...page, dy: 5, scrollTop: 300 })).toBeNull();
    expect(pullDirection({ ...page, dy: -5, scrollTop: 300 })).toBeNull();
    expect(pullDirection({ ...page, dy: -5, scrollTop: 0 })).toBeNull();
    expect(pullDirection({ ...page, dy: 5, scrollTop: 1400 })).toBeNull();
  });

  it("not past the first or last entry", () => {
    expect(pullDirection({ ...page, hasPrev: false, dy: 5, scrollTop: 0 })).toBeNull();
    expect(pullDirection({ ...page, hasNext: false, dy: -5, scrollTop: 1400 })).toBeNull();
  });

  it("a page shorter than the screen is at both ends", () => {
    const short = { scrollHeight: 500, clientHeight: 600, scrollTop: 0, hasPrev: true, hasNext: true };
    expect(pullDirection({ ...short, dy: 5 })).toBe("prev");
    expect(pullDirection({ ...short, dy: -5 })).toBe("next");
  });

  it("the page follows the finger at half speed, up to a limit", () => {
    expect(pullOffset(0)).toBe(0);
    expect(pullOffset(40)).toBe(20);
    expect(pullOffset(1000)).toBe(PULL_THRESHOLD_PX);
  });
});

function Day() {
  return <p>The day page: {useParams().date}</p>;
}

function renderAt(path, { from } = {}) {
  const store = configureStore({
    reducer: { auth: authReducer, journal: journalReducer, timeline: timelineReducer, network: networkReducer, error: errorReducer, notification: notificationReducer },
    preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" }, network: { online: true } },
  });
  function From() {
    const navigate = useNavigate();
    return <button onClick={() => navigate(path, { state: { atKey: null } })}>The previous screen: open the entry</button>;
  }
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[from ?? path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/days/:date" element={<Day />} />
          <Route path="/somewhere" element={<From />} />
          <Route path="/trips/:tripId/activities/:id" element={<EntryPage kind="activity" />} />
          <Route path="/trips/:tripId/stays/:id" element={<EntryPage kind="stay" />} />
          <Route path="/trips/:tripId/travel/:id" element={<EntryPage kind="travel" />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

const scrollRoot = () => document.querySelector("[data-scroll-root]");

/** One finger from `from` to `to` (clientY), in steps, then let go. */
function drag(el, from, to, { lift = true } = {}) {
  fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: from }] });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    fireEvent.touchMove(el, { touches: [{ clientX: 100, clientY: from + ((to - from) * i) / steps }] });
  }
  if (lift) fireEvent.touchEnd(el, { touches: [] });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
  apiClient.get.mockResolvedValue({ data: TRIP });
});

describe("pulling past the end of an entry's page", () => {
  // jsdom has no layout: every page is "shorter than the screen", so at both ends.
  it("pulling up at the bottom goes to the next entry", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-1");
    await screen.findByRole("article", { name: "Old Town & Zytglogge walk" });
    drag(scrollRoot(), 500, 500 - PULL_THRESHOLD_PX - 20);
    expect(await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeInTheDocument();
  });

  it("pulling down at the top goes to the previous one", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-2");
    await screen.findByRole("article", { name: "Dinner at Kornhauskeller" });
    drag(scrollRoot(), 200, 200 + PULL_THRESHOLD_PX + 20);
    expect(await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeInTheDocument();
  });

  it("says what letting go will do, and a short pull springs back", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-1");
    await screen.findByRole("article", { name: "Old Town & Zytglogge walk" });
    drag(scrollRoot(), 500, 460, { lift: false });
    expect(screen.getByText(/^Pull for next/)).toBeInTheDocument();
    act(() => {
      fireEvent.touchMove(scrollRoot(), { touches: [{ clientX: 100, clientY: 380 }] });
    });
    expect(screen.getByText(/^Release for next/)).toBeInTheDocument();
    // Back under the line before letting go: stays put.
    fireEvent.touchMove(scrollRoot(), { touches: [{ clientX: 100, clientY: 450 }] });
    fireEvent.touchEnd(scrollRoot(), { touches: [] });
    expect(screen.queryByText(/for next/)).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Old Town & Zytglogge walk" })).toBeInTheDocument();
  });

  it("mid-page, a drag is just a scroll", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-2");
    await screen.findByRole("article", { name: "Dinner at Kornhauskeller" });
    const root = scrollRoot();
    Object.defineProperty(root, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 600 });
    root.scrollTop = 700;
    drag(root, 500, 300);
    drag(root, 300, 500);
    expect(screen.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeInTheDocument();
  });

  it("a scroll that reaches the end stops there; a fresh touch pulls on", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-1");
    await screen.findByRole("article", { name: "Old Town & Zytglogge walk" });
    const root = scrollRoot();
    Object.defineProperty(root, "scrollHeight", { configurable: true, value: 850 });
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 700 });
    root.scrollTop = 0;
    // The browser scrolls the first 150 px of the drag (jsdom doesn't, so by hand).
    fireEvent.touchStart(root, { touches: [{ clientX: 100, clientY: 600 }] });
    for (let y = 580; y >= 200; y -= 20) {
      root.scrollTop = Math.min(150, 600 - y);
      fireEvent.touchMove(root, { touches: [{ clientX: 100, clientY: y }] });
    }
    expect(screen.queryByText(/for next/)).not.toBeInTheDocument();
    fireEvent.touchEnd(root, { touches: [] });
    expect(screen.getByRole("article", { name: "Old Town & Zytglogge walk" })).toBeInTheDocument();

    drag(root, 600, 450);
    expect(await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeInTheDocument();
  });

  it("sideways isn't a pull, nor is a pull past the last entry", async () => {
    renderAt("/trips/trip-1/travel/travel-3");
    await screen.findByRole("article", { name: "Zürich → Chicago" });
    drag(scrollRoot(), 500, 300); // nothing after the last entry
    fireEvent.touchStart(scrollRoot(), { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchMove(scrollRoot(), { touches: [{ clientX: 200, clientY: 210 }] });
    fireEvent.touchMove(scrollRoot(), { touches: [{ clientX: 300, clientY: 400 }] });
    fireEvent.touchEnd(scrollRoot(), { touches: [] });
    expect(screen.getByRole("article", { name: "Zürich → Chicago" })).toBeInTheDocument();
  });

  it("not while a dialog is open", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-2");
    await screen.findByRole("article", { name: "Dinner at Kornhauskeller" });
    fireEvent.click(screen.getByRole("button", { name: "Edit activity" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    drag(scrollRoot(), 500, 300);
    expect(screen.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeInTheDocument();
  });
});

describe("where a pull goes", () => {
  it("the hint names the entry it goes to", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-1");
    await screen.findByRole("article", { name: "Old Town & Zytglogge walk" });
    drag(scrollRoot(), 500, 460, { lift: false });
    expect(screen.getByText(/^Pull for next$/)).toBeInTheDocument();
    expect(screen.getByText("Check in · Hotel Goldener Schlüssel")).toBeInTheDocument();
    fireEvent.touchEnd(scrollRoot(), { touches: [] });
    drag(scrollRoot(), 200, 240, { lift: false });
    expect(screen.getByText(/^Pull for previous$/)).toBeInTheDocument();
    expect(screen.getByText("Lunch at Altes Tramdepot")).toBeInTheDocument();
    fireEvent.touchEnd(scrollRoot(), { touches: [] });
  });

  it("never into another day: the day's last entry has no next, its first no previous", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-2"); // Dinner, the last on May 11
    await screen.findByRole("article", { name: "Dinner at Kornhauskeller" });
    drag(scrollRoot(), 500, 300);
    expect(screen.queryByText(/for next/)).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeInTheDocument();
  });

  it("the day's first entry has no previous (the day before's last is next door in the trip)", async () => {
    renderAt("/trips/trip-1/activities/2026-05-12-0"); // the Rose Garden, first on May 12
    await screen.findByRole("article", { name: "Morning at the Rose Garden" });
    drag(scrollRoot(), 200, 400);
    expect(screen.queryByText(/for previous/)).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Morning at the Rose Garden" })).toBeInTheDocument();
  });

  it("not before the first entry", async () => {
    renderAt("/trips/trip-1/travel/travel-0");
    await screen.findByRole("article", { name: "Chicago → Zürich" });
    drag(scrollRoot(), 200, 400);
    expect(screen.queryByText(/for previous/)).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Chicago → Zürich" })).toBeInTheDocument();
  });

  it("back onto a stay's check-out, it steps on from there", async () => {
    renderAt("/trips/trip-1/travel/travel-3");
    await screen.findByRole("article", { name: "Zürich → Chicago" });
    drag(scrollRoot(), 200, 400);
    await screen.findByRole("article", { name: "Beausite Park Hotel" });
    drag(scrollRoot(), 500, 460, { lift: false });
    expect(screen.getByText("Zürich → Chicago")).toBeInTheDocument();
    fireEvent.touchEnd(scrollRoot(), { touches: [] });
    // The check-out is May 14's first entry: Fondue night (May 13) isn't a pull away.
    drag(scrollRoot(), 200, 240, { lift: false });
    expect(screen.queryByText(/for previous/)).not.toBeInTheDocument();
    fireEvent.touchEnd(scrollRoot(), { touches: [] });
  });

  it("moving replaces the address: ← goes back where you came from, past every entry", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1/stays/stay-1", { from: "/somewhere" });
    await user.click(screen.getByRole("button", { name: /open the entry/ }));
    await screen.findByRole("article", { name: "Beausite Park Hotel" });
    drag(scrollRoot(), 500, 300);
    await screen.findByRole("article", { name: "Dinner at the hotel" });
    drag(scrollRoot(), 500, 300);
    await screen.findByRole("article", { name: "Stargazing from the balcony" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /open the entry/ })).toBeInTheDocument();
  });

  it("opened directly, ← goes to the entry's day, after moving too", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1/activities/2026-05-11-1");
    await screen.findByRole("article", { name: "Old Town & Zytglogge walk" });
    drag(scrollRoot(), 500, 300);
    await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("The day page: 2026-05-11")).toBeInTheDocument();
  });

  it("opened from an overnight leg's arrival, it moves through the arrival's day", async () => {
    renderAt("/trips/trip-1/travel/travel-0", { from: "/somewhere" });
    fireEvent.click(screen.getByRole("button", { name: /open the entry/ }));
    await screen.findByRole("article", { name: "Chicago → Zürich" });
    // No atKey (opened from elsewhere): its first row, the departure on May 10, alone that day.
    drag(scrollRoot(), 500, 460, { lift: false });
    expect(screen.queryByText(/for next/)).not.toBeInTheDocument();
    fireEvent.touchEnd(scrollRoot(), { touches: [] });
  });
});
