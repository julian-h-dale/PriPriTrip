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
import networkReducer, { setOnline, setSavedOnly } from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { JournalPage } from "@/features/journal/JournalPage";
import { fetchMemories, syncOutbox } from "@/features/journal/journalSlice";
import { deviceZone } from "@/features/journal/journalDays";
import { TodayPage } from "@/features/today/TodayPage";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
import { apiClient } from "@/shared/services/apiClient";
import { clearOutbox, pending } from "@/shared/services/outbox";
import { clearAll, saveMemories, saveTrip } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const USER = "user-1";
const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z", role: "editor" };
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

function renderAt(path, { online = true, savedOnly = false } = {}) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: fakeToken(USER), user: null, status: "idle" }, network: { online, savedOnly } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/journal" element={<JournalPage />} />
          <Route path="/trips/:tripId/today" element={<TodayPage />} />
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
  await clearOutbox(USER);
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
    await vi.waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        "/trips/trip-1/memories/m1",
        { text: "memory m1, better", isPublic: false },
        expect.anything()
      )
    );
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
    await vi.waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/memories/m3", expect.anything())
    );
    await vi.waitFor(() => expect(screen.queryByRole("region", { name: "Tue, May 12" })).not.toBeInTheDocument());
  });

  it("offline: reads the saved journal, writes into the outbox, and syncs once back online", async () => {
    const user = userEvent.setup();
    await saveTrip(USER, TRIP);
    await saveMemories(USER, "trip-1", MEMORIES);
    apiClient.get.mockRejectedValue(Object.assign(new Error("Network Error"), { config: {} }));
    const store = renderAt("/trips/trip-1/journal", { online: false });
    expect(await screen.findByRole("region", { name: "Mon, May 11" })).toBeInTheDocument();

    // Writing works offline: it shows at once, waiting to sync, and nothing is sent.
    await user.click(screen.getByRole("button", { name: "New memory" }));
    await user.type(screen.getByLabelText("What happened?"), "Written in the mountains");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const card = (await screen.findByText("Written in the mountains")).closest("li");
    expect(within(card).getByText("Waiting to sync")).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(store.getState().notification.items.map((n) => n.message)).toContain(
      "Saved on this phone — it’ll sync when you’re online"
    );
    const [queued] = await pending(USER);
    expect(queued).toMatchObject({ op: "create", tripId: "trip-1", body: { text: "Written in the mountains" } });

    // Back online: it's sent once, with the phone's id and time, and settles.
    apiClient.post.mockImplementation(async (url, body) => ({
      data: { ...body, updatedAt: null, receivedAt: new Date().toISOString(), authorEmail: "user@example.com", mine: true },
    }));
    store.dispatch(setOnline(true));
    await store.dispatch(syncOutbox());
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post.mock.calls[0][1]).toEqual({
      id: queued.memoryId,
      createdAt: queued.body.createdAt,
      text: "Written in the mountains",
      zone: queued.body.zone,
      location: null, // no location here (no GPS in this test)
      isPublic: false,
    });
    expect(await pending(USER)).toEqual([]);
    await vi.waitFor(() => expect(within(card).queryByText("Waiting to sync")).not.toBeInTheDocument());
  });

  it("with “Use saved copies only” on: a memory waits on the phone, and goes when it's off", async () => {
    const user = userEvent.setup();
    await saveTrip(USER, TRIP);
    await saveMemories(USER, "trip-1", MEMORIES);
    apiClient.get.mockRejectedValue(Object.assign(new Error("Saved copies only"), { config: {} }));
    const store = renderAt("/trips/trip-1/journal", { savedOnly: true });
    await screen.findByRole("region", { name: "Mon, May 11" });
    await user.click(screen.getByRole("button", { name: "New memory" }));
    await user.type(screen.getByLabelText("What happened?"), "Written on roaming");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Written on roaming");
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(store.getState().notification.items.map((n) => n.message)).toContain(
      "Saved on this phone — it’ll sync when “Use saved copies only” is off"
    );
    expect(await pending(USER)).toHaveLength(1);

    apiClient.post.mockImplementation(async (url, body) => ({
      data: { ...body, updatedAt: null, receivedAt: new Date().toISOString(), authorEmail: "user@example.com", mine: true },
    }));
    await store.dispatch(setSavedOnly(false));
    await store.dispatch(syncOutbox());
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(await pending(USER)).toEqual([]);
  });

  it("a write the server rejects for good is dropped, not retried forever", async () => {
    apiClient.post.mockRejectedValue({ response: { status: 404 } });
    const store = renderAt("/trips/trip-1/journal");
    await screen.findByRole("region", { name: "Mon, May 11" });
    await userEvent.click(screen.getByRole("button", { name: "New memory" }));
    await userEvent.type(screen.getByLabelText("What happened?"), "lost");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(async () => expect(await pending(USER)).toEqual([]));
    expect(store.getState().notification.items.map((n) => n.message)).toContain(
      "A memory couldn’t be saved and was dropped."
    );
    expect(screen.queryByText("lost")).not.toBeInTheDocument();
  });
});

describe("New memory in the top bar", () => {
  it("is on every trip page, filled blue, before Search; the Journal has no button of its own", async () => {
    const user = userEvent.setup();
    renderAt("/trips/trip-1");
    const button = await screen.findByRole("button", { name: "New memory" });
    expect(button).toHaveClass("bg-primary");
    const bar = button.closest("header");
    const names = within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names.indexOf("New memory")).toBe(names.indexOf("Search this trip") - 1);
    expect(within(bar).queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
    await user.click(button);
    expect(screen.getByRole("dialog", { name: "New memory" })).toBeInTheDocument();
  });

  it("the Journal page's own header has no New memory", async () => {
    renderAt("/trips/trip-1/journal");
    const header = (await screen.findByRole("heading", { name: "Journal" })).closest("header");
    expect(within(header).queryByRole("button", { name: "New memory" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New memory" })).toHaveLength(1);
  });

  it("sends the phone's own id and time (UTC, when Save was tapped) with the text and zone", async () => {
    const user = userEvent.setup();
    apiClient.post.mockImplementation(async (url, body) => ({ data: { ...body, mine: true } }));
    const store = renderAt("/trips/trip-1/today");
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const dialog = screen.getByRole("dialog", { name: "New memory" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("What happened?"), "  Great fondue  ");
    const before = Date.now();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    const [url, body] = apiClient.post.mock.calls[0];
    expect(url).toBe("/trips/trip-1/memories");
    expect(body.text).toBe("Great fondue");
    expect(body.zone).toBe(deviceZone());
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(body.createdAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(body.createdAt).toMatch(/Z$/);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(store.getState().notification.items.map((n) => n.message)).toContain("Memory saved");
  });
});

describe("public memories", () => {
  it("a new memory is private unless the switch is on, and the switch reaches the server", async () => {
    const user = userEvent.setup();
    apiClient.post.mockImplementation(async (url, body) => ({ data: { ...body, mine: true } }));
    renderAt("/trips/trip-1/journal");
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const dialog = screen.getByRole("dialog", { name: "New memory" });
    const toggle = within(dialog).getByRole("switch", { name: "Visible to viewers" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.type(within(dialog).getByLabelText("What happened?"), "For the family");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({ text: "For the family", isPublic: true });
  });

  it("editing a public memory starts with the switch on, and turning it off is sent", async () => {
    const user = userEvent.setup();
    const shared = [memory("p1", "2026-05-11T18:30:00Z", "Europe/Zurich", { isPublic: true, text: "for the family" })];
    apiClient.get.mockImplementation(async (url) =>
      url.endsWith("/memories") ? { data: structuredClone(shared) } : { data: TRIP }
    );
    apiClient.put.mockResolvedValue({ data: { ...shared[0], isPublic: false } });
    renderAt("/trips/trip-1/journal");
    // Wait for the fetched journal: a cached copy from another test can render first.
    const card = (await screen.findByText("for the family")).closest("li");
    expect(within(card).getByText("Public")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Memory options" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit memory" });
    const toggle = within(dialog).getByRole("switch", { name: "Visible to viewers" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        "/trips/trip-1/memories/p1",
        { text: "for the family", isPublic: false },
        expect.anything()
      )
    );
  });

  it("a viewer reads what's shared, with no New memory, no badge and no upload bar", async () => {
    const asViewer = { ...TRIP, role: "viewer" };
    const shared = [
      memory("p2", "2026-05-11T19:00:00Z", "Europe/Zurich", { mine: false, isPublic: true, text: "shared with you" }),
    ];
    apiClient.get.mockImplementation(async (url) =>
      url.endsWith("/memories") ? { data: structuredClone(shared) } : { data: asViewer }
    );
    renderAt("/trips/trip-1/journal");
    // Wait for the fetched journal (a cached copy can render first).
    expect(await screen.findByText("shared with you")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByText("memory m1")).not.toBeInTheDocument());
    expect(screen.getByText("What the travelers have shared")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New memory" })).not.toBeInTheDocument();
    expect(screen.queryByText("Public")).not.toBeInTheDocument();
  });

  it("a viewer with nothing shared yet sees an empty state", async () => {
    const asViewer = { ...TRIP, role: "viewer" };
    apiClient.get.mockImplementation(async (url) =>
      url.endsWith("/memories") ? { data: [] } : { data: asViewer }
    );
    renderAt("/trips/trip-1/journal");
    expect(await screen.findByText("Nothing shared yet")).toBeInTheDocument();
  });

  it("a viewer's Today tab has no New memory", async () => {
    apiClient.get.mockImplementation(async (url) =>
      url.endsWith("/memories") ? { data: [] } : { data: { ...TRIP, role: "viewer" } }
    );
    renderAt("/trips/trip-1/today");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "New memory" })).not.toBeInTheDocument();
  });
});

describe("signing out with memories still waiting", () => {
  it("warns first; staying keeps them, confirming signs out and forgets them", async () => {
    const user = userEvent.setup();
    const { TopBar } = await import("@/shared/components/TopBar");
    const store = configureStore({
      reducer: {
        auth: authReducer,
        journal: journalReducer,
        network: networkReducer,
        error: errorReducer,
        notification: notificationReducer,
      },
      preloadedState: {
        auth: { token: fakeToken(USER), user: { email: "u@x.com", is_superuser: false }, status: "idle" },
        journal: { tripId: null, items: [], status: "idle", stale: false, pendingCount: 2 },
      },
    });
    render(
      <Provider store={store}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <TopBar title="Trip" />
        </MemoryRouter>
      </Provider>
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const warning = screen.getByRole("dialog", { name: "Sign out anyway?" });
    expect(warning).toHaveTextContent("2 memories haven’t synced yet");
    await user.click(within(warning).getByRole("button", { name: "Stay signed in" }));
    expect(store.getState().auth.token).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(within(screen.getByRole("dialog", { name: "Sign out anyway?" })).getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => expect(store.getState().auth.token).toBeNull());
  });

  it("warns harder when photos are waiting for Upload, even with every memory synced", async () => {
    const user = userEvent.setup();
    const { TopBar } = await import("@/shared/components/TopBar");
    const store = configureStore({
      reducer: { auth: authReducer, journal: journalReducer, network: networkReducer, error: errorReducer, notification: notificationReducer },
      preloadedState: {
        auth: { token: fakeToken(USER), user: { email: "u@x.com", is_superuser: false }, status: "idle" },
        journal: { tripId: null, items: [], status: "idle", stale: false, pendingCount: 0, waitingPhotos: { count: 3, bytes: 9e6 }, upload: null },
      },
    });
    render(
      <Provider store={store}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <TopBar title="Trip" />
        </MemoryRouter>
      </Provider>
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const warning = screen.getByRole("dialog", { name: "Sign out anyway?" });
    expect(warning).toHaveTextContent("3 photos haven’t been uploaded yet");
    expect(warning).toHaveTextContent("aren’t saved anywhere else");
    expect(store.getState().auth.token).not.toBeNull();
  });
});

describe("coming back online", () => {
  it("a memory that syncs while the journal is refreshing doesn't vanish", async () => {
    const user = userEvent.setup();
    const store = renderAt("/trips/trip-1/journal", { online: false });
    await screen.findByRole("region", { name: "Mon, May 11" });
    await user.click(screen.getByRole("button", { name: "New memory" }));
    await user.type(screen.getByLabelText("What happened?"), "Written offline");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Written offline");

    // The refresh asks the server *before* the upload lands, and its answer
    // (without the new memory) arrives *after* the outbox has sent it.
    const answers = []; // every request held until we say so (the page refreshes too)
    apiClient.get.mockImplementation(
      (url) =>
        new Promise((resolve) => {
          answers.push(() => resolve({ data: url.endsWith("/memories") ? structuredClone(MEMORIES) : TRIP }));
        })
    );
    apiClient.post.mockImplementation(async (url, body) => ({ data: { ...body, mine: true, photos: [] } }));
    const refresh = store.dispatch(fetchMemories("trip-1"));
    await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0));
    store.dispatch(setOnline(true));
    await store.dispatch(syncOutbox());
    answers.forEach((resolve) => resolve());
    await refresh;
    await vi.waitFor(() => expect(answers.every(Boolean)).toBe(true));

    expect(screen.getByText("Written offline")).toBeInTheDocument();
    expect(within(screen.getByText("Written offline").closest("li")).queryByText("Waiting to sync")).not.toBeInTheDocument();
  });

  it("…nor does one whose photos are still waiting for Upload", async () => {
    const user = userEvent.setup();
    const store = renderAt("/trips/trip-1/journal", { online: false });
    await screen.findByRole("region", { name: "Mon, May 11" });
    await user.click(screen.getByRole("button", { name: "New memory" }));
    await user.type(screen.getByLabelText("What happened?"), "With a photo");
    await user.upload(screen.getByLabelText("Choose photos"), new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("With a photo");

    const answers = [];
    apiClient.get.mockImplementation(
      (url) =>
        new Promise((resolve) => {
          answers.push(() => resolve({ data: url.endsWith("/memories") ? structuredClone(MEMORIES) : TRIP }));
        })
    );
    apiClient.post.mockImplementation(async (url, body) => ({ data: { ...body, mine: true, photos: [] } }));
    const refresh = store.dispatch(fetchMemories("trip-1"));
    await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0));
    store.dispatch(setOnline(true));
    await store.dispatch(syncOutbox());
    answers.forEach((resolve) => resolve());
    await refresh;

    const card = screen.getByText("With a photo").closest("li");
    expect(within(card).queryByText("Waiting to sync")).not.toBeInTheDocument();
    expect(within(card).getAllByTitle("Waiting to upload")).toHaveLength(1);
    expect(apiClient.post).toHaveBeenCalledTimes(1); // the memory, not the photo
  });
});
