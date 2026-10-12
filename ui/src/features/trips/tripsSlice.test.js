import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer, { updateTrip } from "@/features/trips/tripsSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import notificationReducer from "@/shared/notificationSlice";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll, readTrip, readTripList, saveTrip, saveTripList } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({ apiClient: { patch: vi.fn() } }));

const SUMMARY = {
  id: "t1",
  name: "Bern",
  startDate: "2099-05-10",
  endDate: "2099-05-14",
  timezone: "Europe/Zurich",
  stayCount: 2,
  travelCount: 4,
  createdAt: "2026-10-02T05:24:40Z",
  role: "owner",
  coverEmoji: null,
  coverThumbUrl: null,
};
const OTHER = { ...SUMMARY, id: "t2", name: "Athens" };
const TRIP = { id: "t1", name: "Bern", startDate: "2099-05-10", days: [], stays: [], travels: [] };

function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, trips: tripsReducer, timeline: timelineReducer, notification: notificationReducer },
    preloadedState: {
      auth: { token: fakeToken("user-1"), user: null, status: "idle" },
      trips: { items: [SUMMARY, OTHER], status: "idle", stale: false, savedAt: null },
      timeline: { trip: TRIP, tripId: "t1", status: "idle", stale: false, savedAt: null },
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
});

describe("updateTrip (Run stage 29)", () => {
  it("renames: the list, the open trip and both saved copies take the new name", async () => {
    await saveTrip("user-1", TRIP);
    await saveTripList("user-1", [SUMMARY, OTHER]);
    apiClient.patch.mockResolvedValue({ data: { ...SUMMARY, name: "Swiss Alps" } });
    const store = makeStore();

    await store.dispatch(updateTrip({ id: "t1", changes: { name: "Swiss Alps" } }));

    expect(apiClient.patch).toHaveBeenCalledWith("/trips/t1", { name: "Swiss Alps" }, { silent: true });
    expect(store.getState().trips.items.map((t) => t.name)).toEqual(["Swiss Alps", "Athens"]);
    expect(store.getState().timeline.trip.name).toBe("Swiss Alps");
    expect((await readTrip("user-1", "t1")).data.name).toBe("Swiss Alps");
    expect((await readTripList("user-1")).data.map((t) => t.name)).toEqual(["Swiss Alps", "Athens"]);
    expect(store.getState().notification.items).toEqual([expect.objectContaining({ message: "Saved" })]);
  });

  it("a cover reaches the list and the open trip", async () => {
    apiClient.patch.mockResolvedValue({ data: { ...SUMMARY, coverThumbUrl: "/photos/p1/thumb" } });
    const store = makeStore();
    await store.dispatch(updateTrip({ id: "t1", changes: { coverPhotoId: "p1" } }));
    expect(store.getState().trips.items[0].coverThumbUrl).toBe("/photos/p1/thumb");
    expect(store.getState().timeline.trip.coverThumbUrl).toBe("/photos/p1/thumb");
  });

  it("a refusal is rejected with the server's message and changes nothing", async () => {
    apiClient.patch.mockRejectedValue({
      response: { status: 422, data: { detail: [{ msg: "Value error, A trip needs a name" }] } },
    });
    const store = makeStore();
    const result = await store.dispatch(updateTrip({ id: "t1", changes: { name: "" } }));
    expect(result.payload).toBe("A trip needs a name");
    expect(store.getState().trips.items[0].name).toBe("Bern");

    apiClient.patch.mockRejectedValue({ response: { status: 422, data: { detail: "Pick a photo from a memory everyone can see." } } });
    expect((await store.dispatch(updateTrip({ id: "t1", changes: { coverPhotoId: "x" } }))).payload).toBe(
      "Pick a photo from a memory everyone can see."
    );
    apiClient.patch.mockRejectedValue(new Error("network"));
    expect((await store.dispatch(updateTrip({ id: "t1", changes: { name: "A" } }))).payload).toBe("Couldn’t save. Try again.");
  });
});
