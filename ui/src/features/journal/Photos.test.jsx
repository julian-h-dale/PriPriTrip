import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { MemoryPage } from "@/features/journal/MemoryPage";
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
  // Read at each request, so a test can add to the list as the server saves.
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
          <Route path="/trips/:tripId/journal/:memoryId" element={<MemoryPage />} />
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

/** Tap a memory's tile in the journal: its full page opens. */
async function openMemory(user, text) {
  await user.click(await screen.findByRole("link", { name: new RegExp(text) }));
  return screen.findByRole("article", { name: "Memory" });
}

describe("adding photos to a memory", () => {
  it("sends the memory at once; its photos wait for Upload, then go in the order picked", async () => {
    const user = userEvent.setup();
    const posts = [];
    apiClient.post.mockImplementation(async (url, body) => {
      posts.push({ url, body });
      if (body instanceof FormData) return { data: photo(body.get("id")) };
      return { data: { ...body, photos: [], mine: true, authorEmail: "user@example.com", receivedAt: body.createdAt } };
    });
    const store = renderJournal();
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const dialog = screen.getByRole("dialog", { name: "New memory" });
    await user.type(within(dialog).getByLabelText("What happened?"), "Two photos");
    const MB = 1024 * 1024;
    await user.upload(within(dialog).getByLabelText("Choose photos"), [picture("a.jpg", 1.5 * MB), picture("b.jpg", 1.5 * MB)]);
    expect(within(dialog).getAllByRole("button", { name: /^Remove new photo/ })).toHaveLength(2);
    expect(within(dialog).getByText(/wait on this phone until you tap Upload/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    // The memory syncs by itself; the photos stay on the phone.
    const bar = await screen.findByRole("region", { name: "Photos waiting to upload" });
    expect(within(bar).getByText("2 photos waiting · 3.0 MB")).toBeInTheDocument();
    expect(within(bar).getByText(/aren’t in your camera roll/)).toBeInTheDocument();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/trips/trip-1/memories");
    expect(await pending(USER)).toHaveLength(2);

    await user.click(within(bar).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(posts).toHaveLength(3));
    await waitFor(() =>
      expect(store.getState().notification.items.map((n) => n.message)).toContain("Photos uploaded")
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: "Photos waiting to upload" })).not.toBeInTheDocument());
    const memoryId = posts[0].body.id;
    for (const p of posts.slice(1)) {
      expect(p.url).toBe(`/trips/trip-1/memories/${memoryId}/photos`);
      expect(p.body.get("id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(p.body.get("file")).toBeInstanceOf(Blob);
    }
    expect(posts.slice(1).map((p) => p.body.get("file").name)).toEqual(["a.jpg", "b.jpg"]);
    await waitFor(async () => expect(await pending(USER)).toEqual([]));
    // The tile now shows the first uploaded thumbnail from the API, and says there are two.
    const card = screen.getByText("Two photos").closest("li");
    const imgs = [...card.querySelectorAll("img")]; // decorative (alt=""), so not role "img"
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      `${appConfig.apiBaseUrl}/photos/${posts[1].body.get("id")}/thumb`,
    ]);
    expect(within(card).getByText("2 photos")).toBeInTheDocument();
  });

  it("an interrupted upload stops, says so, and carries on later without sending a photo twice", async () => {
    const user = userEvent.setup();
    const sent = [];
    let dropNext = false;
    apiClient.post.mockImplementation(async (url, body) => {
      if (body instanceof FormData) {
        if (dropNext) {
          dropNext = false;
          throw new Error("Network Error"); // no response: the signal dropped
        }
        sent.push(body.get("file").name);
        if (sent.length === 1) dropNext = true;
        return { data: photo(body.get("id")) };
      }
      return { data: { ...body, photos: [], mine: true, authorEmail: "user@example.com", receivedAt: body.createdAt } };
    });
    const store = renderJournal();
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const dialog = screen.getByRole("dialog", { name: "New memory" });
    await user.type(within(dialog).getByLabelText("What happened?"), "Three photos");
    await user.upload(within(dialog).getByLabelText("Choose photos"), [picture("a.jpg"), picture("b.jpg"), picture("c.jpg")]);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const bar = await screen.findByRole("region", { name: "Photos waiting to upload" });
    await waitFor(() => expect(within(bar).getByText(/^3 photos waiting/)).toBeInTheDocument());
    await user.click(within(bar).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(within(bar).getByText(/^2 photos waiting/)).toBeInTheDocument());
    expect(store.getState().notification.items.map((n) => n.message)).toContain(
      "Upload stopped: 2 photos are still on this phone. Tap Upload to carry on."
    );

    await user.click(within(bar).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Photos waiting to upload" })).not.toBeInTheDocument());
    expect(sent).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
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
    expect(screen.getByRole("button", { name: "Take photo" })).toBeDisabled();
  });

  it("Take photo opens the back camera, one shot at a time, and joins the previews", async () => {
    const user = userEvent.setup();
    renderJournal();
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const camera = screen.getByLabelText("Take a photo");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", "image/*");
    expect(camera).not.toHaveAttribute("multiple");
    const click = vi.spyOn(camera, "click");
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    expect(click).toHaveBeenCalled();
    await user.upload(camera, picture("shot.jpg"));
    await user.upload(screen.getByLabelText("Choose photos"), picture("library.jpg"));
    expect(screen.getAllByRole("button", { name: /^Remove new photo/ })).toHaveLength(2);
  });

  it("editing can remove a photo (and add more)", async () => {
    const user = userEvent.setup();
    apiClient.put.mockImplementation(async (url, body) => ({ data: { ...WITH_PHOTOS, ...body } }));
    apiClient.delete.mockResolvedValue({ data: null });
    renderJournal([WITH_PHOTOS]);
    const page = await openMemory(user, "Lake Thun");
    await user.click(within(page).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit memory" });
    await user.click(within(dialog).getByRole("button", { name: "Remove photo 2" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/memories/m1/photos/p2", expect.anything())
    );
    expect(within(page).getAllByRole("button", { name: /^Photo \d of/ })).toHaveLength(1);
  });
});

describe("looking at photos", () => {
  it("opens full screen on the display copy, steps through, and loads the original on request", async () => {
    const user = userEvent.setup();
    renderJournal([WITH_PHOTOS]);
    await openMemory(user, WITH_PHOTOS.text);
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

describe("closing the viewer with a tap", () => {
  it("a tap on the photo or around it closes; the arrows and a swipe don't", async () => {
    const user = userEvent.setup();
    renderJournal([WITH_PHOTOS]);
    await openMemory(user, WITH_PHOTOS.text);
    await user.click(await screen.findByRole("button", { name: "Photo 1 of 2" }));
    let viewer = screen.getByRole("dialog", { name: "Photo 1 of 2" });

    await user.click(within(viewer).getByRole("button", { name: "Next photo" }));
    viewer = screen.getByRole("dialog", { name: "Photo 2 of 2" }); // still open

    // A swipe back is a swipe, not a tap, even if the browser sends a click after it.
    const img = viewer.querySelector("img");
    fireEvent.touchStart(img, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchEnd(img, { changedTouches: [{ clientX: 250, clientY: 305 }] });
    viewer = screen.getByRole("dialog", { name: "Photo 1 of 2" });
    fireEvent.click(viewer.querySelector("img"));
    expect(screen.getByRole("dialog", { name: "Photo 1 of 2" })).toBeInTheDocument();

    // The next real tap still closes it.
    const shown = viewer.querySelector("img");
    fireEvent.touchStart(shown, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchEnd(shown, { changedTouches: [{ clientX: 102, clientY: 301 }] });
    fireEvent.click(shown);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Photo 2 of 2" }));
    await user.click(screen.getByRole("dialog", { name: "Photo 2 of 2" }).querySelector("img").parentElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // the black around it
  });
});

describe("Save to phone, for a photo still waiting to upload", () => {
  async function openWaitingPhoto(user) {
    // The server lists what it saved (the page reloads the journal).
    const onServer = [];
    apiClient.post.mockImplementation(async (url, body) => {
      const saved = { ...body, photos: [], mine: true, authorEmail: "user@example.com", receivedAt: body.createdAt };
      onServer.push(saved);
      return { data: saved };
    });
    renderJournal(onServer);
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const dialog = screen.getByRole("dialog", { name: "New memory" });
    await user.type(within(dialog).getByLabelText("What happened?"), "Sunset");
    await user.upload(within(dialog).getByLabelText("Take a photo"), picture("shot.jpg"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await openMemory(user, "Sunset");
    await user.click(await screen.findByRole("button", { name: "Photo 1 of 1" }));
    const viewer = screen.getByRole("dialog", { name: "Photo 1 of 1" });
    expect(within(viewer).queryByRole("link", { name: "Download original" })).not.toBeInTheDocument();
    const save = within(viewer).getByRole("button", { name: "Save to phone" });
    await waitFor(() => expect(save).toBeEnabled()); // the file is read ahead
    return save;
  }

  function stub(name, value) {
    Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
  }
  afterEach(() => {
    delete navigator.share;
    delete navigator.canShare;
    vi.restoreAllMocks();
  });

  it("opens the share sheet with the photo's own file", async () => {
    const user = userEvent.setup();
    const share = vi.fn(async () => {});
    stub("canShare", () => true);
    stub("share", share);
    await user.click(await openWaitingPhoto(user));
    expect(share).toHaveBeenCalledTimes(1);
    const [file] = share.mock.calls[0][0].files;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("shot.jpg");
    expect(file.size).toBe(1000);
  });

  it("downloads it where the browser can't share files", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL ??= () => "blob:x";
    URL.revokeObjectURL ??= () => {};
    await user.click(await openWaitingPhoto(user));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0].download).toBe("shot.jpg");
  });
});
