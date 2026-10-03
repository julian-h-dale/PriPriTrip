import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer, { fetchTrips } from "@/features/trips/tripsSlice";
import timelineReducer, { createItem, fetchTrip, selectReadOnly } from "@/features/timeline/timelineSlice";
import networkReducer, { setOnline } from "@/shared/networkSlice";
import notificationReducer from "@/shared/notificationSlice";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll, readTrip, readTripList, saveTrip, saveTripList } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const USER = "user-1";
const SAVED = { id: "t1", name: "Saved copy", startDate: "2026-05-10", endDate: "2026-05-14" };
const FRESH = { ...SAVED, name: "Server copy" };

const networkError = () => Object.assign(new Error("Network Error"), { config: {} });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });

function makeStore(token = fakeToken(USER)) {
  return configureStore({
    reducer: {
      auth: authReducer,
      trips: tripsReducer,
      timeline: timelineReducer,
      network: networkReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token, user: null, status: "idle" } },
  });
}

/** A get() that stays pending until released, to observe the state in between. */
function deferredGet() {
  let release;
  apiClient.get.mockReturnValueOnce(new Promise((resolve, reject) => (release = { resolve, reject })));
  return () => release;
}

describe("trip (timeline) cache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAll();
  });

  it("renders the saved copy before the network answers, then the server's wins", async () => {
    await saveTrip(USER, SAVED);
    const store = makeStore();
    const release = deferredGet();
    const done = store.dispatch(fetchTrip("t1"));
    await vi.waitFor(() => expect(store.getState().timeline.trip?.name).toBe("Saved copy"));

    release().resolve({ data: FRESH });
    await done;
    const { timeline } = store.getState();
    expect(timeline.trip.name).toBe("Server copy");
    expect(timeline.stale).toBe(false);
    expect((await readTrip(USER, "t1")).data.name).toBe("Server copy");
  });

  it("keeps the saved copy, marked stale and read-only, when the network fails", async () => {
    await saveTrip(USER, SAVED);
    apiClient.get.mockRejectedValueOnce(networkError());
    const store = makeStore();
    await store.dispatch(fetchTrip("t1"));
    const { timeline } = store.getState();
    expect(timeline.trip.name).toBe("Saved copy");
    expect(timeline.stale).toBe(true);
    expect(timeline.savedAt).toBeTruthy();
    expect(timeline.status).toBe("idle");
    expect(selectReadOnly(store.getState())).toBe(true);
  });

  it("asks for the offline-tolerant request, so no error toast fires", async () => {
    apiClient.get.mockResolvedValueOnce({ data: FRESH });
    await makeStore().dispatch(fetchTrip("t1"));
    expect(apiClient.get).toHaveBeenCalledWith("/trips/t1", expect.objectContaining({ offlineOk: true }));
  });

  it("fails as before when there's no saved copy", async () => {
    apiClient.get.mockRejectedValueOnce(networkError());
    const store = makeStore();
    await store.dispatch(fetchTrip("t1"));
    expect(store.getState().timeline.status).toBe("failed");
    expect(store.getState().timeline.trip).toBeNull();
  });

  it("drops the saved copy on a real 404", async () => {
    await saveTrip(USER, SAVED);
    apiClient.get.mockRejectedValueOnce(httpError(404));
    const store = makeStore();
    await store.dispatch(fetchTrip("t1"));
    expect(store.getState().timeline.status).toBe("notFound");
    expect(store.getState().timeline.trip).toBeNull();
    expect(await readTrip(USER, "t1")).toBeFalsy();
  });

  it("an edit refreshes the saved copy", async () => {
    apiClient.get.mockResolvedValueOnce({ data: SAVED });
    apiClient.post.mockResolvedValueOnce({ data: { ...SAVED, name: "After edit" } });
    const store = makeStore();
    await store.dispatch(fetchTrip("t1"));
    await store.dispatch(createItem({ tripId: "t1", item: { title: "x" } }));
    expect((await readTrip(USER, "t1")).data.name).toBe("After edit");
  });

  it("is read-only whenever the browser is offline", async () => {
    const store = makeStore();
    expect(selectReadOnly(store.getState())).toBe(false);
    store.dispatch(setOnline(false));
    expect(selectReadOnly(store.getState())).toBe(true);
  });
});

describe("trips list cache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAll();
  });

  it("shows the saved list offline, marked stale", async () => {
    await saveTripList(USER, [SAVED]);
    apiClient.get.mockRejectedValueOnce(networkError());
    const store = makeStore();
    await store.dispatch(fetchTrips());
    const { trips } = store.getState();
    expect(trips.items.map((t) => t.name)).toEqual(["Saved copy"]);
    expect(trips.stale).toBe(true);
    expect(trips.status).toBe("idle");
  });

  it("saves the list and caches every trip that hasn't ended, skipping past ones", async () => {
    const upcoming = { id: "t2", name: "Okinawa", startDate: "2099-10-29", endDate: "2099-11-13", timezone: "Asia/Tokyo" };
    const past = { id: "t3", name: "Old", startDate: "2001-01-01", endDate: "2001-01-05", timezone: "UTC" };
    apiClient.get.mockImplementation(async (url) => {
      if (url === "/trips") return { data: [past, upcoming] };
      if (url === "/trips/t2") return { data: { ...upcoming, days: [] } };
      throw new Error(`unexpected ${url}`);
    });
    await makeStore().dispatch(fetchTrips());
    expect((await readTripList(USER)).data).toHaveLength(2);
    await vi.waitFor(async () => expect((await readTrip(USER, "t2"))?.data.name).toBe("Okinawa"));
    expect(apiClient.get).not.toHaveBeenCalledWith("/trips/t3", expect.anything());
  });

  it("caches nothing without a user id in the token", async () => {
    apiClient.get.mockResolvedValueOnce({ data: [SAVED] });
    await makeStore("not-a-jwt").dispatch(fetchTrips());
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});
