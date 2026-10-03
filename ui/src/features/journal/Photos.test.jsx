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
import { appConfig } from "@/shared/config/appConfig";
import { apiClient } from "@/shared/services/apiClient";
import { clearOutbox, pending } from "@/shared/services/outbox";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/shared/services/geolocation", () => ({
  geolocationAvailable: () => false,
  permissionState: vi.fn(async () => "prompt"),
  currentPosition: vi.fn(async () => null),
  watchPosition: vi.fn(() => () => {}),
}));

const USER = "user-1";
const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", role: "owner" };
const photo = (id) => ({
  id,
  width: 4032,
  height: 3024,
  thumbUrl: `/photos/${id}/thumb`,
  displayUrl: `/photos/${id}/display`,
  originalUrl: `/photos/${id}/original`,
});
const WITH_PHOTOS = {
  id: "m1",
  text: "Lake Thun",
  zone: "Europe/Zurich",
  createdAt: "2026-05-12T10:00:00Z",
  updatedAt: null,
  receivedAt: "2026-05-12T10:00:01Z",
  location: null,
  photos: [photo("p1"), photo("p2")],
  authorEmail: "user@example.com",
  mine: true,
};

const picture = (name, size = 1000) => new File([new Uint8Array(size)], name, { type: "image/jpeg" });

function renderJournal(memories = []) {
  apiClient.get.mockImplementation(async (url) =>
    url.endsWith("/memories") ? { data: structuredClone(memories) } : { data: TRIP }
  );
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: fakeToken(USER), user: { email: "user@example.com" }, status: "idle" } },
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

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
  await clearOutbox(USER);
});

describe("adding photos to a memory", () => {
  it("queues the memory first, then each photo with its own id, and uploads them in that order", async () => {
    const user = userEvent.setup();
    const posts = [];
    apiClient.post.mockImplementation(async (url, body) => {
      posts.push({ url, body });
      if (body instanceof FormData) return { data: photo(body.get("id")) };
      return { data: { ...body, photos: [], mine: true, authorEmail: "user@example.com", receivedAt: body.createdAt } };
    });
    renderJournal();
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const dialog = screen.getByRole("dialog", { name: "New memory" });
    await user.type(within(dialog).getByLabelText("What happened?"), "Two photos");
    await user.upload(within(dialog).getByLabelText("Choose photos"), [picture("a.jpg"), picture("b.jpg")]);
    expect(within(dialog).getAllByRole("button", { name: /^Remove new photo/ })).toHaveLength(2);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[0].url).toBe("/trips/trip-1/memories");
    const memoryId = posts[0].body.id;
    for (const p of posts.slice(1)) {
      expect(p.url).toBe(`/trips/trip-1/memories/${memoryId}/photos`);
      expect(p.body.get("id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(p.body.get("file")).toBeInstanceOf(Blob);
    }
    await waitFor(async () => expect(await pending(USER)).toEqual([]));
    // The strip now shows the uploaded thumbnails from the API.
    const card = screen.getByText("Two photos").closest("li");
    const imgs = [...card.querySelectorAll("img")]; // decorative (alt=""), so not role "img"
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(
      posts.slice(1).map((p) => `${appConfig.apiBaseUrl}/photos/${p.body.get("id")}/thumb`)
    );
  });

  it("refuses photos over 25 MB and more than 10", async () => {
    const user = userEvent.setup();
    renderJournal();
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const input = screen.getByLabelText("Choose photos");
    await user.upload(input, [picture("huge.jpg", 25 * 1024 * 1024 + 1)]);
    expect(screen.getByText(/over 25 MB/)).toBeInTheDocument();
    await user.upload(input, Array.from({ length: 12 }, (_, i) => picture(`p${i}.jpg`)));
    expect(screen.getAllByRole("button", { name: /^Remove new photo/ })).toHaveLength(10);
    expect(screen.getByText("A memory holds at most 10 photos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeDisabled();
  });

  it("editing can remove a photo (and add more)", async () => {
    const user = userEvent.setup();
    apiClient.put.mockImplementation(async (url, body) => ({ data: { ...WITH_PHOTOS, ...body } }));
    apiClient.delete.mockResolvedValue({ data: null });
    renderJournal([WITH_PHOTOS]);
    const card = (await screen.findByText("Lake Thun")).closest("li");
    await user.click(within(card).getByRole("button", { name: "Memory options" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit memory" });
    await user.click(within(dialog).getByRole("button", { name: "Remove photo 2" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/memories/m1/photos/p2", expect.anything())
    );
    expect(within(card).getAllByRole("button", { name: /^Photo \d of/ })).toHaveLength(1);
  });
});

describe("looking at photos", () => {
  it("opens full screen on the display copy, steps through, and loads the original on request", async () => {
    const user = userEvent.setup();
    renderJournal([WITH_PHOTOS]);
    await user.click(await screen.findByRole("button", { name: "Photo 1 of 2" }));
    const viewer = screen.getByRole("dialog", { name: "Photo 1 of 2" });
    const shown = () => viewer.querySelector("img").getAttribute("src");
    expect(shown()).toBe(`${appConfig.apiBaseUrl}/photos/p1/display`);
    expect(within(viewer).getByRole("link", { name: "Download original" })).toHaveAttribute(
      "href",
      `${appConfig.apiBaseUrl}/photos/p1/original`
    );
    await user.click(within(viewer).getByRole("button", { name: "Next photo" }));
    expect(shown()).toBe(`${appConfig.apiBaseUrl}/photos/p2/display`);
    await user.click(within(viewer).getByRole("button", { name: "Full quality" }));
    expect(shown()).toBe(`${appConfig.apiBaseUrl}/photos/p2/original`);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
