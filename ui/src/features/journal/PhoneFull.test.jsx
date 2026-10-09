import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

/*
 * Run stage 24, Phase 90: when the phone can't keep a write (IndexedDB
 * refuses: out of space), the app never says "Saved on this phone". It
 * sends the write at once if it can, and otherwise says plainly that it
 * exists only on screen.
 */

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/shared/services/geolocation", () => ({
  geolocationAvailable: () => false,
  permissionState: vi.fn(async () => "prompt"),
  currentPosition: vi.fn(async () => null),
  watchPosition: vi.fn(() => () => {}),
}));
// The phone is full: nothing can be queued.
vi.mock("@/shared/services/outbox", async (importOriginal) => ({
  ...(await importOriginal()),
  enqueue: vi.fn(async () => false),
}));

const USER = "user-1";
const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", role: "owner" };

function renderJournal({ online }) {
  apiClient.get.mockImplementation(async (url) => (url.endsWith("/memories") ? { data: [] } : { data: TRIP }));
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: {
      auth: { token: fakeToken(USER), user: { email: "user@example.com" }, status: "idle" },
      network: { online, savedOnly: false },
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/trips/trip-1/journal"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/journal" element={<JournalPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

async function writeMemory(user, text) {
  await user.click(await screen.findByRole("button", { name: "New memory" }));
  const dialog = screen.getByRole("dialog", { name: "New memory" });
  await user.type(within(dialog).getByLabelText("What happened?"), text);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
}

const messages = (store) => store.getState().notification.items.map((n) => n.message);

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
});

describe("when the phone can't save a memory", () => {
  it("offline: never says it's saved; the memory says it exists only on screen", async () => {
    const user = userEvent.setup();
    const store = renderJournal({ online: false });
    await writeMemory(user, "Sunset at the pier");
    await waitFor(() => expect(messages(store).some((m) => m.startsWith("This phone couldn’t save it"))).toBe(true));
    expect(messages(store).some((m) => m.startsWith("Saved on this phone"))).toBe(false);
    const card = screen.getByText("Sunset at the pier").closest("li");
    expect(within(card).getByRole("alert")).toHaveTextContent("Not saved on this phone: copy your words");
  });

  it("online: it's sent at once instead, and saved as usual", async () => {
    const user = userEvent.setup();
    apiClient.post.mockImplementation(async (url, body) => ({
      data: { ...body, photos: [], mine: true, authorEmail: "user@example.com", receivedAt: body.createdAt },
    }));
    const store = renderJournal({ online: true });
    await writeMemory(user, "Sent straight away");
    await waitFor(() => expect(messages(store)).toContain("Memory saved"));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/memories",
      expect.objectContaining({ text: "Sent straight away" }),
      expect.anything()
    );
    const card = screen.getByText("Sent straight away").closest("li");
    expect(within(card).queryByText(/Not saved on this phone/)).not.toBeInTheDocument();
    expect(within(card).queryByText("Waiting to sync")).not.toBeInTheDocument();
  });

  it("online but the send fails too: it says so", async () => {
    const user = userEvent.setup();
    apiClient.post.mockRejectedValue({ response: { status: 503 } });
    const store = renderJournal({ online: true });
    await writeMemory(user, "Nowhere to go");
    await waitFor(() => expect(messages(store).some((m) => m.startsWith("This phone couldn’t save it"))).toBe(true));
    expect(screen.getByText(/Not saved on this phone/)).toBeInTheDocument();
  });
});
