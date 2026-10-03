import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { JournalPage } from "@/features/journal/JournalPage";
import { deviceZone } from "@/features/journal/journalDays";
import { TodayPage } from "@/features/today/TodayPage";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll, saveMemories, saveTrip } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const USER = "user-1";
const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z", role: "viewer" };
const memory = (id, createdAt, zone, extra = {}) => ({
  id,
  text: `memory ${id}`,
  zone,
  createdAt,
  updatedAt: null,
  authorEmail: "user@example.com",
  mine: true,
  ...extra,
});
// May 11 evening in Zurich; then one by someone else; then a Tokyo-zone one.
const MEMORIES = [
  memory("m1", "2026-05-11T18:30:00Z", "Europe/Zurich"),
  memory("m2", "2026-05-11T19:00:00Z", "Europe/Zurich", { mine: false, authorEmail: "owner@example.com" }),
  memory("m3", "2026-05-12T06:00:00Z", "Asia/Tokyo", { updatedAt: "2026-05-12T07:00:00Z" }),
];

function renderAt(path, { online = true } = {}) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: fakeToken(USER), user: null, status: "idle" }, network: { online } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/journal" element={<JournalPage />} />
          <Route path="/trips/:tripId/today" element={<TodayPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
  apiClient.get.mockImplementation(async (url) =>
    url.endsWith("/memories") ? { data: structuredClone(MEMORIES) } : { data: TRIP }
  );
});

describe("Journal tab", () => {
  it("groups memories by the day they were written, where they were written", async () => {
    renderAt("/trips/trip-1/journal");
    const may11 = await screen.findByRole("region", { name: "Mon, May 11" });
    expect(within(may11).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("memory m1"),
      expect.stringContaining("memory m2"),
    ]);
    // 06:00Z on May 12 is 3 PM that day in Tokyo, labelled with its zone.
    const may12 = screen.getByRole("region", { name: "Tue, May 12" });
    expect(within(may12).getByText(/3:00 PM · Tokyo time · You · edited/)).toBeInTheDocument();
    expect(within(may11).getByText(/owner@example\.com/)).toBeInTheDocument();
  });

  it("offers Edit and Delete only on your own memories", async () => {
    renderAt("/trips/trip-1/journal");
    const may11 = await screen.findByRole("region", { name: "Mon, May 11" });
    const [mine, theirs] = within(may11).getAllByRole("listitem");
    expect(within(mine).getByRole("button", { name: "Memory options" })).toBeInTheDocument();
    expect(within(theirs).queryByRole("button", { name: "Memory options" })).not.toBeInTheDocument();
  });

  it("editing keeps a memory in its place", async () => {
    const user = userEvent.setup();
    apiClient.put.mockResolvedValue({
      data: { ...MEMORIES[0], text: "memory m1, better", updatedAt: "2026-05-13T00:00:00Z" },
    });
    renderAt("/trips/trip-1/journal");
    const may11 = await screen.findByRole("region", { name: "Mon, May 11" });
    await user.click(within(within(may11).getAllByRole("listitem")[0]).getByRole("button", { name: "Memory options" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit memory" });
    const box = within(dialog).getByLabelText("What happened?");
    await user.clear(box);
    await user.type(box, "memory m1, better");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(apiClient.put).toHaveBeenCalledWith("/trips/trip-1/memories/m1", { text: "memory m1, better" }, { silent: true });
    const items = within(screen.getByRole("region", { name: "Mon, May 11" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("memory m1, better");
    expect(items[1]).toHaveTextContent("memory m2");
  });

  it("deletes your memory after confirming", async () => {
    const user = userEvent.setup();
    apiClient.delete.mockResolvedValue({ data: null });
    renderAt("/trips/trip-1/journal");
    const may12 = await screen.findByRole("region", { name: "Tue, May 12" });
    await user.click(within(may12).getByRole("button", { name: "Memory options" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete memory?" })).getByRole("button", { name: "Delete" }));
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/memories/m3", { silent: true });
    await vi.waitFor(() => expect(screen.queryByRole("region", { name: "Tue, May 12" })).not.toBeInTheDocument());
  });

  it("offline: reads the saved journal, and writing is off", async () => {
    await saveTrip(USER, TRIP);
    await saveMemories(USER, "trip-1", MEMORIES);
    apiClient.get.mockRejectedValue(Object.assign(new Error("Network Error"), { config: {} }));
    renderAt("/trips/trip-1/journal", { online: false });
    expect(await screen.findByRole("region", { name: "Mon, May 11" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New memory" })).toBeDisabled();
  });
});

describe("New memory on the Today tab", () => {
  it("saves the text with the phone's zone; the server stamps the time", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: memory("new", "2026-05-11T20:00:00Z", deviceZone(), { text: "Great fondue" }) });
    const store = renderAt("/trips/trip-1/today");
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const dialog = screen.getByRole("dialog", { name: "New memory" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("What happened?"), "  Great fondue  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/memories",
      { text: "Great fondue", zone: deviceZone() },
      { silent: true }
    );
    const body = apiClient.post.mock.calls[0][1];
    expect(body).not.toHaveProperty("createdAt");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(store.getState().notification.items.map((n) => n.message)).toContain("Memory saved");
  });
});
