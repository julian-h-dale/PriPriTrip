import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer, {
  fetchMemories,
  outcomeOf,
  retryAfterUpdate,
  syncOutbox,
  uploadPhotos,
} from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { JournalPage } from "@/features/journal/JournalPage";
import { apiClient } from "@/shared/services/apiClient";
import { clearOutbox, enqueue, markStuck, pending } from "@/shared/services/outbox";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

/*
 * Run stage 24: nothing the server refuses is thrown away. A refused write
 * stays in the outbox marked stuck, stays on its memory on screen, and is
 * sent again only when asked (Try again, Try all again, Upload, or once
 * after an app update).
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

const USER = "user-1";
const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", role: "owner" };
const MEMORY_ID = "11111111-1111-4111-8111-111111111111";
const ON_SERVER = {
  id: MEMORY_ID,
  text: "Lake Thun",
  zone: "Europe/Zurich",
  createdAt: "2026-05-12T10:00:00Z",
  updatedAt: null,
  receivedAt: "2026-05-12T10:00:01Z",
  location: null,
  photos: [],
  authorEmail: "user@example.com",
  mine: true,
};
const uploaded = (id) => ({
  id,
  width: 4032,
  height: 3024,
  thumbUrl: `/photos/${id}/thumb`,
  displayUrl: `/photos/${id}/display`,
  originalUrl: `/photos/${id}/original`,
});
const REFUSED = { response: { status: 422, data: { detail: "Only JPEG, PNG, WebP or HEIC photos" } } };
const savedMemory = async (url, body) =>
  body instanceof FormData
    ? { data: uploaded(body.get("id")) }
    : { data: { ...body, photos: [], mine: true, authorEmail: "user@example.com", receivedAt: body.createdAt } };

let serverMemories;

function renderJournal() {
  apiClient.get.mockImplementation(async (url) =>
    url.endsWith("/memories") ? { data: structuredClone(serverMemories) } : { data: TRIP }
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

const photoFile = (name = "IMG_0001.JPG") => ({ bytes: new Uint8Array(1000).buffer, type: "image/jpeg", name });

/** A photo waiting on the phone for the server's memory (optionally already refused). */
async function queuePhoto(photoId, { stuck = false, memoryId = MEMORY_ID } = {}) {
  await enqueue({
    userId: USER,
    tripId: "trip-1",
    memoryId,
    entryId: `photo-${photoId}`,
    op: "addPhoto",
    body: { photoId, file: photoFile(`${photoId}.jpg`) },
  });
  if (stuck) await markStuck(USER, `photo-${photoId}`, { status: 422, message: "Only JPEG, PNG, WebP or HEIC photos" });
}

const messages = (store) => store.getState().notification.items.map((n) => n.message);
const photoPosts = () => apiClient.post.mock.calls.filter(([, body]) => body instanceof FormData);

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
  await clearOutbox(USER);
  serverMemories = [ON_SERVER];
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

describe("what a failed send means", () => {
  it("later: no answer, 401, a password to change, busy, server errors; stuck: any other refusal", () => {
    const err = (status, detail) => ({ response: { status, data: { detail } } });
    expect(outcomeOf(new Error("Network Error"))).toBe("later");
    for (const status of [401, 408, 429, 500, 503]) expect(outcomeOf(err(status))).toBe("later");
    expect(outcomeOf(err(403, "PASSWORD_CHANGE_REQUIRED"))).toBe("later");
    for (const status of [400, 403, 404, 409, 413, 422]) expect(outcomeOf(err(status, "no"))).toBe("stuck");
  });
});

describe("a photo the server refuses", () => {
  it("stays in the outbox and on its memory, through a reload, with the reason and a way to save it", async () => {
    const user = userEvent.setup();
    apiClient.post.mockRejectedValue(REFUSED);
    await queuePhoto("p-camera");
    const store = renderJournal();
    const bar = await screen.findByRole("region", { name: "Photos waiting to upload" });
    await user.click(within(bar).getByRole("button", { name: "Upload" }));

    await waitFor(async () => expect((await pending(USER))[0]?.stuck?.status).toBe(422));
    expect(messages(store)).toContain("A photo couldn’t be uploaded. It’s still on this phone.");
    await waitFor(() => expect(messages(store)).toContain("1 couldn’t upload: it’s still on this phone, see the journal."));
    const photos = () => store.getState().journal.items.find((m) => m.id === MEMORY_ID).photos;
    expect(photos()).toMatchObject([{ id: "p-camera", pending: true, stuck: { status: 422 } }]);

    // A reload: the saved copy, then the server's list (which never had it).
    await store.dispatch(fetchMemories("trip-1"));
    expect(photos()).toMatchObject([{ id: "p-camera", stuck: { message: "Only JPEG, PNG, WebP or HEIC photos" } }]);
    expect(screen.getByText(/A photo couldn’t upload: Only JPEG, PNG, WebP or HEIC photos/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Couldn’t upload" })).toHaveTextContent("1 couldn’t upload");

    // Opened, it says why and offers Save to phone, Try again and Remove.
    await user.click(screen.getByRole("button", { name: "Photo 1 of 1, couldn’t upload" }));
    const viewer = screen.getByRole("dialog", { name: "Photo 1 of 1" });
    expect(within(viewer).getByText(/Couldn’t upload: Only JPEG/)).toBeInTheDocument();
    expect(within(viewer).getByRole("button", { name: "Save to phone" })).toBeInTheDocument();
    expect(within(viewer).getByRole("button", { name: "Try again" })).toBeInTheDocument();

    // Remove asks first, and only then deletes it from the phone.
    await user.click(within(viewer).getByRole("button", { name: "Remove" }));
    expect(await pending(USER)).toHaveLength(1);
    await user.click(within(viewer).getByRole("button", { name: "Delete from this phone" }));
    await waitFor(async () => expect(await pending(USER)).toEqual([]));
    await waitFor(() => expect(photos()).toEqual([]));
    expect(screen.queryByRole("region", { name: "Couldn’t upload" })).not.toBeInTheDocument();
  });

  it("Try again in the viewer sends just that photo; accepted, it's uploaded", async () => {
    const user = userEvent.setup();
    apiClient.post.mockImplementation(savedMemory);
    await queuePhoto("p-stuck", { stuck: true });
    await queuePhoto("p-waiting");
    const store = renderJournal();
    await user.click(await screen.findByRole("button", { name: "Photo 1 of 2, couldn’t upload" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Try again" }));
    await waitFor(async () => expect((await pending(USER)).map((op) => op.entryId)).toEqual(["photo-p-waiting"]));
    expect(photoPosts().map(([, body]) => body.get("id"))).toEqual(["p-stuck"]);
    await waitFor(() => expect(messages(store)).toContain("Uploaded"));
  });
});

describe("a memory the server refuses", () => {
  it("stays on screen, stuck, and holds its photos (not sent, not stuck, not dropped)", async () => {
    const user = userEvent.setup();
    serverMemories = [];
    apiClient.post.mockImplementation(async (url, body) => {
      if (body instanceof FormData) return { data: uploaded(body.get("id")) };
      throw { response: { status: 422, data: { detail: [{ msg: "A memory is at most 2000 characters" }] } } };
    });
    const store = renderJournal();
    await user.click(await screen.findByRole("button", { name: "New memory" }));
    const dialog = screen.getByRole("dialog", { name: "New memory" });
    await user.type(within(dialog).getByLabelText("What happened?"), "Too long, say");
    await user.upload(within(dialog).getByLabelText("Choose photos"), new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Couldn’t upload: A memory is at most 2000 characters/)).toBeInTheDocument();

    // Upload tries the memory again (refused again) and holds its photo behind it.
    await user.click(within(screen.getByRole("region", { name: "Photos waiting to upload" })).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(messages(store).some((m) => m.startsWith("Upload stopped: 1 photo"))).toBe(true));
    expect(photoPosts()).toHaveLength(0);
    const ops = await pending(USER);
    expect(ops.map((op) => [op.op, Boolean(op.stuck)])).toEqual([
      ["create", true],
      ["addPhoto", false],
    ]);
    expect(screen.getByText("Too long, say")).toBeInTheDocument();

    // Removing it says it's for good, and takes its waiting photo too.
    await user.click(screen.getByRole("button", { name: "Remove" }));
    const confirm = screen.getByRole("dialog", { name: "Remove from this phone?" });
    expect(confirm).toHaveTextContent("deletes it for good");
    expect(confirm).toHaveTextContent("Its photo goes too");
    await user.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(async () => expect(await pending(USER)).toEqual([]));
    await waitFor(() => expect(screen.queryByText("Too long, say")).not.toBeInTheDocument());
  });

  it("an edit to a stuck memory clears its mark and goes again", async () => {
    await enqueue({ userId: USER, tripId: "trip-1", memoryId: MEMORY_ID, op: "update", body: { text: "too long" } });
    await markStuck(USER, MEMORY_ID, { status: 422, message: "too long" });
    await enqueue({ userId: USER, tripId: "trip-1", memoryId: MEMORY_ID, op: "update", body: { text: "shorter" } });
    expect(await pending(USER)).toMatchObject([{ op: "update", body: { text: "shorter" } }]);
    expect((await pending(USER))[0].stuck).toBeUndefined();
  });
});

describe("after an admin password reset", () => {
  it("everything waits (nothing stuck, nothing dropped), then goes once the password is changed", async () => {
    const mustChange = { response: { status: 403, data: { detail: "PASSWORD_CHANGE_REQUIRED" } } };
    apiClient.put.mockRejectedValue(mustChange);
    await enqueue({ userId: USER, tripId: "trip-1", memoryId: MEMORY_ID, op: "update", body: { text: "edited" } });
    await enqueue({ userId: USER, tripId: "trip-1", memoryId: "m-2", op: "update", body: { text: "also" } });
    const store = renderJournal();
    await store.dispatch(syncOutbox());
    expect(apiClient.put).toHaveBeenCalledTimes(1); // the pass stopped at the first
    expect((await pending(USER)).map((op) => op.stuck ?? null)).toEqual([null, null]);

    apiClient.put.mockImplementation(async (url, body) => ({ data: { ...ON_SERVER, ...body } }));
    await store.dispatch(syncOutbox());
    expect(await pending(USER)).toEqual([]);
  });
});

describe("resync", () => {
  it("Try all again sends every stuck write once, but not photos still waiting for Upload", async () => {
    const user = userEvent.setup();
    apiClient.post.mockImplementation(async (url, body) => {
      if (body instanceof FormData && body.get("id") === "p-bad") throw REFUSED;
      return savedMemory(url, body);
    });
    await queuePhoto("p-stuck", { stuck: true });
    await queuePhoto("p-bad", { stuck: true });
    await queuePhoto("p-waiting");
    renderJournal();
    const bar = await screen.findByRole("region", { name: "Couldn’t upload" });
    expect(bar).toHaveTextContent("2 couldn’t upload");
    await user.click(within(bar).getByRole("button", { name: "Try all again" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Couldn’t upload" })).toHaveTextContent("1 couldn’t upload"));
    expect(photoPosts().map(([, body]) => body.get("id"))).toEqual(["p-stuck", "p-bad"]);
    const left = await pending(USER);
    expect(left.map((op) => [op.entryId, Boolean(op.stuck)])).toEqual([
      ["photo-p-bad", true],
      ["photo-p-waiting", false],
    ]);
  });

  it("Upload sends the waiting photos and tries the stuck ones, naming those still refused", async () => {
    apiClient.post.mockImplementation(async (url, body) => {
      if (body.get("id") === "p-bad") throw REFUSED;
      return { data: uploaded(body.get("id")) };
    });
    await queuePhoto("p-bad", { stuck: true });
    await queuePhoto("p-waiting");
    const store = renderJournal();
    await screen.findByRole("region", { name: "Couldn’t upload" });
    await store.dispatch(uploadPhotos());
    expect(photoPosts().map(([, body]) => body.get("id"))).toEqual(["p-bad", "p-waiting"]);
    expect(messages(store)).toContain("1 couldn’t upload: it’s still on this phone, see the journal.");
    expect((await pending(USER)).map((op) => op.entryId)).toEqual(["photo-p-bad"]);
  });

  it("after an app update, stuck writes are put back in line once: memories go, photos wait for Upload", async () => {
    apiClient.put.mockImplementation(async (url, body) => ({ data: { ...ON_SERVER, ...body } }));
    await enqueue({ userId: USER, tripId: "trip-1", memoryId: MEMORY_ID, op: "update", body: { text: "fixed now" } });
    await markStuck(USER, MEMORY_ID, { status: 422, message: "no" });
    await queuePhoto("p-stuck", { stuck: true });
    const store = renderJournal();
    await screen.findByRole("region", { name: "Couldn’t upload" });

    // The very first start of the app: nothing to compare with, no retry.
    await store.dispatch(retryAfterUpdate());
    expect((await pending(USER)).every((op) => op.stuck)).toBe(true);

    localStorage.setItem("pripritrip-last-build", "an older build");
    await store.dispatch(retryAfterUpdate());
    await store.dispatch(syncOutbox());
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(await pending(USER)).toMatchObject([{ entryId: "photo-p-stuck" }]);
    expect((await pending(USER))[0].stuck).toBeUndefined(); // waiting for Upload again
    expect(store.getState().journal.waitingPhotos.count).toBe(1);

    // The same version again: no second retry.
    await markStuck(USER, "photo-p-stuck", { status: 422, message: "no" });
    await store.dispatch(retryAfterUpdate());
    expect((await pending(USER))[0].stuck).toBeTruthy();
  });
});

describe("deleting what never uploaded asks first", () => {
  it("deleting a memory with a photo still on the phone says the photo goes too", async () => {
    const user = userEvent.setup();
    await queuePhoto("p-waiting");
    renderJournal();
    await screen.findByText("Lake Thun");
    await user.click(screen.getByRole("button", { name: "Memory options" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete memory?" });
    expect(dialog).toHaveTextContent("A photo on it hasn’t uploaded and will be deleted from this phone");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await pending(USER)).toHaveLength(1);
  });

  it("removing a photo that never uploaded in the edit dialog warns, and Keep it undoes it", async () => {
    const user = userEvent.setup();
    await queuePhoto("p-waiting");
    renderJournal();
    await screen.findByText("Lake Thun");
    await user.click(screen.getByRole("button", { name: "Memory options" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit memory" });
    await user.click(within(dialog).getByRole("button", { name: "Remove photo 1" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("saving deletes it from this phone for good");
    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(within(dialog).getByRole("button", { name: "Remove photo 1" })).toBeInTheDocument();
  });
});
