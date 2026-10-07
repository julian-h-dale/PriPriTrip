import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { EntryPage } from "@/features/entry/EntryPage";
import { entryPath, entryPathFor, entrySequence, findEntry, neighbours } from "@/features/entry/entries";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import { TRIP } from "@/test/sampleTrip";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));


function renderAt(path, { from, online = true } = {}) {
  const store = configureStore({
    reducer: { auth: authReducer, journal: journalReducer, timeline: timelineReducer, network: networkReducer, error: errorReducer, notification: notificationReducer },
    preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" }, network: { online } },
  });
  function From() {
    const navigate = useNavigate();
    return <button onClick={() => navigate(path)}>The previous screen: open the entry</button>;
  }
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[from ?? path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/activities/:id" element={<EntryPage kind="activity" />} />
          <Route path="/trips/:tripId/stays/:id" element={<EntryPage kind="stay" />} />
          <Route path="/trips/:tripId/travel/:id" element={<EntryPage kind="travel" />} />
          <Route path="/trips/:tripId/days/:date" element={<p>The day page</p>} />
          <Route path="/somewhere" element={<From />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
  apiClient.get.mockResolvedValue({ data: TRIP });
});

describe("entry addresses", () => {
  it("map each kind to its page, and back", () => {
    expect(entryPath("t", "activity", "a1")).toBe("/trips/t/activities/a1");
    expect(entryPathFor("t", { kind: "stay", stay: { id: "s1" } })).toBe("/trips/t/stays/s1");
    expect(entryPathFor("t", { kind: "travel", phase: "arrive", travel: { id: "x1" } })).toBe("/trips/t/travel/x1");
    expect(findEntry(TRIP, "activity", "2026-05-11-2")).toMatchObject({ date: "2026-05-11", record: { title: "Dinner at Kornhauskeller" } });
    expect(findEntry(TRIP, "travel", "travel-0")).toMatchObject({ date: "2026-05-10" });
    expect(findEntry(TRIP, "stay", "nope")).toBeNull();
  });
});

describe("an entry's page", () => {
  it("a flight: confirmation first, then both ends with their zones and the duration", async () => {
    renderAt("/trips/trip-1/travel/travel-0");
    const page = await screen.findByRole("article", { name: "Chicago → Zürich" });
    expect(within(page).getByText("Flight")).toBeInTheDocument();
    expect(within(page).getByText("SWISS LX 9")).toBeInTheDocument();
    expect(within(page).getByText("SAMPLE-LX7Q2K")).toBeInTheDocument();
    const when = within(page).getByRole("region", { name: "When" });
    expect(when).toHaveTextContent(/Departs\s*5:40 PM\s*Sun, May 10 · Chicago time\s*Chicago O'Hare/);
    expect(when).toHaveTextContent(/Arrives\s*9:25 AM\s*Mon, May 11/);
    expect(when).toHaveTextContent("8h 45m");
    // The confirmation comes before when.
    const text = page.textContent;
    expect(text.indexOf("SAMPLE-LX7Q2K")).toBeLessThan(text.indexOf("Departs"));
    // Facts not already shown above.
    expect(within(page).getByText("23A")).toBeInTheDocument();
    expect(within(page).queryByText("Duration")).not.toBeInTheDocument();
  });

  it("a stay: check in and out, and the nights", async () => {
    renderAt("/trips/trip-1/stays/stay-1");
    const page = await screen.findByRole("article", { name: "Beausite Park Hotel" });
    const when = within(page).getByRole("region", { name: "When" });
    expect(when).toHaveTextContent(/Check in\s*3:00 PM\s*Tue, May 12/);
    expect(when).toHaveTextContent(/Check out\s*10:00 AM\s*Thu, May 14/);
    expect(when).toHaveTextContent("2 nights");
    expect(within(page).getByText("Double, Jungfrau view")).toBeInTheDocument();
    expect(within(page).getByText("SAMPLE-1002")).toBeInTheDocument();
  });

  it("an activity: its time, notes and place", async () => {
    renderAt("/trips/trip-1/activities/2026-05-13-0");
    const page = await screen.findByRole("article", { name: "Männlichen → Kleine Scheidegg hike" });
    expect(within(page).getByRole("region", { name: "When" })).toHaveTextContent(/9:30 AM – 12:30 PM\s*Wed, May 13/);
    expect(within(page).getByRole("region", { name: "Notes" })).toBeInTheDocument();
    expect(within(page).getByRole("link", { name: "Open map" })).toBeInTheDocument();
  });

  it("an activity with no time says so", async () => {
    renderAt("/trips/trip-1/activities/2026-05-11-1");
    const when = within(await screen.findByRole("article", { name: "Old Town & Zytglogge walk" })).getByRole("region", { name: "When" });
    expect(when).toHaveTextContent("Mon, May 11No set time");
  });

  it("says when it isn't on the trip any more", async () => {
    renderAt("/trips/trip-1/stays/gone");
    expect(await screen.findByText("This isn’t on the trip any more")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the trip" })).toHaveAttribute("href", "/trips/trip-1");
  });

  it("← is in ☰'s place and goes back where you came from", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1/stays/stay-0", { from: "/somewhere" });
    await user.click(screen.getByRole("button", { name: /open the entry/ }));
    await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" });
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /open the entry/ })).toBeInTheDocument();
  });

  it("opened directly, ← goes to its day", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1/activities/2026-05-12-0");
    await screen.findByRole("article", { name: "Morning at the Rose Garden" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("The day page")).toBeInTheDocument();
  });

  it("works from the phone's saved copy when offline", async () => {
    const { saveTrip } = await import("@/shared/services/tripCache");
    const { userIdFromToken } = await import("@/shared/utils/authToken");
    await saveTrip(userIdFromToken(fakeToken("user-1")), TRIP);
    apiClient.get.mockRejectedValue(new Error("Network Error"));
    renderAt("/trips/trip-1/stays/stay-0");
    expect(await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeInTheDocument();
  });
});

describe("the order entries are pulled through", () => {
  const ids = (steps) => steps.map((s) => `${s.id}${s.key.endsWith("-out") ? " out" : ""}`);

  it("go through the timeline across days, without 'Staying at' rows or a leg's same-day arrival", () => {
    expect(ids(entrySequence(TRIP))).toEqual([
      "travel-0", // May 10; its arrival on May 11 opens the same page, so it's left out
      "travel-1",
      "2026-05-11-0",
      "2026-05-11-1",
      "stay-0",
      "2026-05-11-2",
      "2026-05-12-0",
      "stay-0 out",
      "travel-2",
      "stay-1",
      "2026-05-12-1",
      "2026-05-12-2",
      "2026-05-13-0", // May 13: Beausite's "Staying at" row isn't a step
      "2026-05-13-1",
      "2026-05-13-2",
      "stay-1 out",
      "travel-3",
    ]);
  });

  it("a stay opened from its check-out row steps on from there", () => {
    const steps = entrySequence(TRIP);
    const fromOut = neighbours(steps, "stay", "stay-1", "stay-1-out");
    expect([fromOut.prev.id, fromOut.next.id]).toEqual(["2026-05-13-2", "travel-3"]);
    // Without the row (a reload), it's the stay's first: check-in.
    const first = neighbours(steps, "stay", "stay-1", null);
    expect([first.prev.id, first.next.id]).toEqual(["travel-2", "2026-05-12-1"]);
  });
});

describe("Edit and Delete on an entry's page", () => {
  it("edits with the usual form, and the page shows the change", async () => {
    const user = userEvent.setup();
    const changed = structuredClone(TRIP);
    changed.days[0].items[2] = { ...changed.days[0].items[2], title: "Dinner at 8", version: 2 };
    apiClient.put.mockResolvedValue({ data: changed });
    renderAt("/trips/trip-1/activities/2026-05-11-2");
    await screen.findByRole("article", { name: "Dinner at Kornhauskeller" });
    await user.click(screen.getByRole("button", { name: "Edit activity" }));
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Title"));
    await user.type(within(dialog).getByLabelText("Title"), "Dinner at 8");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("article", { name: "Dinner at 8" })).toBeInTheDocument();
    const [url, body, config] = apiClient.put.mock.calls[0];
    expect(url).toBe("/trips/trip-1/items/2026-05-11-2");
    expect(body.title).toBe("Dinner at 8");
    expect(config.headers["If-Match"]).toBe('"1"');
  });

  it("deletes after asking, then goes to the entry's day", async () => {
    const user = userEvent.setup();
    const without = structuredClone(TRIP);
    without.stays = without.stays.slice(1);
    apiClient.delete.mockResolvedValue({ data: without });
    renderAt("/trips/trip-1/stays/stay-0");
    await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete stay?" });
    expect(confirm).toHaveTextContent("removed from every day it covers");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("The day page")).toBeInTheDocument();
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/stays/stay-0", expect.objectContaining({ headers: { "If-Match": '"1"' } }));
  });

  it("someone else's change (409) closes the form and shows theirs", async () => {
    const user = userEvent.setup();
    const theirs = structuredClone(TRIP);
    theirs.travels[0] = { ...theirs.travels[0], seat: "1A", version: 2 };
    apiClient.put.mockRejectedValue({
      response: { status: 409, data: { detail: { message: "Changed", version: 2, updatedByName: "PriPri", current: theirs.travels[0] } } },
    });
    const store = renderAt("/trips/trip-1/travel/travel-0");
    await screen.findByRole("article", { name: "Chicago → Zürich" });
    apiClient.get.mockResolvedValue({ data: theirs });
    await user.click(screen.getByRole("button", { name: "Edit travel" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("1A")).toBeInTheDocument();
    expect(JSON.stringify(store.getState().notification)).toContain("PriPri changed this");
  });

  it("a viewer gets no actions", async () => {
    apiClient.get.mockResolvedValue({ data: { ...TRIP, role: "viewer" } });
    renderAt("/trips/trip-1/stays/stay-0");
    await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" });
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("offline, the actions are there but greyed", async () => {
    renderAt("/trips/trip-1/stays/stay-0", { online: false });
    await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" });
    expect(screen.getByRole("button", { name: "Edit stay" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
