import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer, { selectOnline, setSavedOnly } from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { TopBar } from "@/shared/components/TopBar";
import { usePhotoSrc } from "@/features/journal/photoUrls";
import { loadRates } from "@/features/currency/currencySlice";
import { OfflineBar } from "@/shared/components/OfflineBar";
import { refreshOnce } from "@/shared/pwa/refreshOnce";
import { clearOutbox, enqueue, pending } from "@/shared/services/outbox";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll, readMemories, readTrip, readTripList } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const USER = "user-1";
const NOW = new Date();
const iso = (days) => new Date(NOW.getTime() + days * 86400000).toISOString().slice(0, 10);
// One trip still to come (saved before the switch goes on), one long over (not).
const UPCOMING = { id: "trip-1", name: "Okinawa", startDate: iso(10), endDate: iso(20), timezone: "Asia/Tokyo" };
const PAST = { id: "trip-0", name: "Bern", startDate: "2020-05-10", endDate: "2020-05-14", timezone: "Europe/Zurich" };

function makeStore({ online = true, savedOnly = false, trip = null } = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: {
      auth: { token: fakeToken(USER), user: { email: "u@x.com" }, status: "idle" },
      network: { online, savedOnly, saving: false },
      ...(trip && { timeline: { ...timelineReducer(undefined, { type: "init" }), trip, tripId: trip.id } }),
    },
  });
}

async function openDrawer(store, path = "/trips") {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TopBar title="x" />
      </MemoryRouter>
    </Provider>
  );
  await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
  return screen.getByRole("navigation", { name: "Menu" });
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await clearAll();
  apiClient.get.mockImplementation(async (url) => {
    if (url === "/trips") return { data: [UPCOMING, PAST] };
    if (url.endsWith("/memories")) return { data: [{ id: "m1", text: "Arrived" }] };
    return { data: { ...UPCOMING, role: "owner", days: [], stays: [], travels: [] } };
  });
});

describe("“Use saved copies only”", () => {
  it("is offline on purpose: selectOnline is false while it's on", () => {
    expect(selectOnline({ network: { online: true, savedOnly: true } })).toBe(false);
    expect(selectOnline({ network: { online: true, savedOnly: false } })).toBe(true);
    expect(selectOnline({ network: { online: false, savedOnly: false } })).toBe(false);
  });

  it("is in the drawer, off, saying what it does", async () => {
    const menu = await openDrawer(makeStore());
    const toggle = within(menu).getByRole("switch", { name: "Use saved copies only" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription(/Saves mobile data/);
  });

  it("is there for a viewer too", async () => {
    const trip = { id: "trip-1", name: "Okinawa", role: "viewer" };
    const menu = await openDrawer(makeStore({ trip }), "/trips/trip-1");
    expect(within(menu).getByRole("switch", { name: "Use saved copies only" })).toBeInTheDocument();
  });

  it("turning it on saves the trips that haven't ended, with their journals, then stays on", async () => {
    const store = makeStore();
    const menu = await openDrawer(store);
    await userEvent.click(within(menu).getByRole("switch", { name: "Use saved copies only" }));
    await waitFor(() => expect(store.getState().network.savedOnly).toBe(true));
    expect(apiClient.get.mock.calls.map(([url]) => url)).toEqual(["/trips", "/trips/trip-1", "/trips/trip-1/memories"]);
    expect((await readTripList(USER)).data).toHaveLength(2);
    expect((await readTrip(USER, "trip-1")).data.name).toBe("Okinawa");
    expect((await readMemories(USER, "trip-1")).data).toEqual([{ id: "m1", text: "Arrived" }]);
    expect(await readTrip(USER, "trip-0")).toBeFalsy(); // past: not fetched
    expect(localStorage.getItem("savedOnly")).toBe("on");
    expect(within(menu).getByRole("switch", { name: "Use saved copies only" })).toHaveAttribute("aria-checked", "true");
  });

  it("is remembered on this phone, and forgotten when turned off", async () => {
    localStorage.setItem("savedOnly", "on");
    expect(networkReducer(undefined, { type: "init" }).savedOnly).toBe(true);
    const store = makeStore({ savedOnly: true });
    await store.dispatch(setSavedOnly(false));
    expect(localStorage.getItem("savedOnly")).toBeNull();
    expect(networkReducer(undefined, { type: "init" }).savedOnly).toBe(false);
  });

  it("turned on offline, it doesn't try to save first", async () => {
    const store = makeStore({ online: false });
    const saveFirst = vi.fn();
    await store.dispatch(setSavedOnly(true, saveFirst));
    expect(saveFirst).not.toHaveBeenCalled();
    expect(store.getState().network.savedOnly).toBe(true);
  });

  it("turned on even if saving fails part way", async () => {
    const store = makeStore();
    await store.dispatch(setSavedOnly(true, async () => Promise.reject(new Error("Network Error"))));
    expect(store.getState().network).toMatchObject({ savedOnly: true, saving: false });
  });
});

describe("journal photos with it on", () => {
  const wrapper = (store) =>
    function Wrapper({ children }) {
      return <Provider store={store}>{children}</Provider>;
    };

  it("load as usual with it off", () => {
    const { result } = renderHook(() => usePhotoSrc("/photos/p1/thumb"), { wrapper: wrapper(makeStore()) });
    expect(result.current).toMatch(/\/photos\/p1\/thumb$/);
  });

  it("show only from the phone's cache, never the network", async () => {
    const saved = new Blob(["jpeg"], { type: "image/jpeg" });
    globalThis.caches = { match: vi.fn(async (url) => (url.endsWith("/p1/thumb") ? new Response(saved) : undefined)) };
    URL.createObjectURL = vi.fn(() => "blob:saved-p1");
    URL.revokeObjectURL = vi.fn();
    const store = makeStore({ savedOnly: true });
    const one = renderHook(() => usePhotoSrc("/photos/p1/thumb"), { wrapper: wrapper(store) });
    expect(one.result.current).toBeNull(); // not until it's found
    await waitFor(() => expect(one.result.current).toBe("blob:saved-p1"));
    const two = renderHook(() => usePhotoSrc("/photos/p2/thumb"), { wrapper: wrapper(store) });
    await new Promise((r) => setTimeout(r, 20));
    expect(two.result.current).toBeNull(); // not saved: the placeholder
    delete globalThis.caches;
  });

  it("a photo still on the phone (blob:) shows either way", () => {
    const { result } = renderHook(() => usePhotoSrc("blob:local"), { wrapper: wrapper(makeStore({ savedOnly: true })) });
    expect(result.current).toBe("blob:local");
  });
});

describe("currency with it on", () => {
  it("never asks Frankfurter, even when the saved rate is old", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const store = makeStore({ savedOnly: true });
    const result = await store.dispatch(loadRates(["CHF"]));
    expect(result.type).toBe("currency/load/rejected");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("Refresh once (Phase 81)", () => {
  it("is on the bar only with saved copies only", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<OfflineBar online={false} savedOnly savedAt="2026-10-07T12:00:00Z" onRefresh={onRefresh} />);
    screen.getByRole("button", { name: "Refresh once" }).click();
    expect(onRefresh).toHaveBeenCalled();
    rerender(<OfflineBar online={false} savedAt="2026-10-07T12:00:00Z" onRefresh={onRefresh} />);
    expect(screen.queryByRole("button", { name: "Refresh once" })).toBeNull();
  });

  it("reloads the list and the open trip, sends waiting memories but not photos, then closes again", async () => {
    await clearOutbox(USER);
    await enqueue({ userId: USER, tripId: "trip-1", memoryId: "m2", op: "create", body: { text: "Queued", createdAt: "2026-10-07T10:00:00Z", zone: "UTC" } });
    await enqueue({
      userId: USER,
      tripId: "trip-1",
      memoryId: "m2",
      entryId: "photo-p1",
      op: "addPhoto",
      body: { photoId: "p1", file: { bytes: new ArrayBuffer(3), type: "image/jpeg", name: "a.jpg" } },
    });
    apiClient.post.mockImplementation(async (url, body) => ({ data: { ...body, id: "m2", mine: true } }));
    const store = makeStore({ savedOnly: true });
    store.dispatch({ type: "timeline/fetchTrip/pending", meta: { arg: "trip-1" } });

    const seen = [];
    apiClient.get.mockImplementation(async (url) => {
      seen.push(store.getState().network.refreshing);
      if (url === "/trips") return { data: [UPCOMING] };
      if (url.endsWith("/memories")) return { data: [] };
      return { data: { ...UPCOMING, role: "owner", days: [], stays: [], travels: [] } };
    });
    await store.dispatch(refreshOnce());

    // (The list also re-saves upcoming trips in the background: /trips/trip-1 again.)
    expect([...new Set(apiClient.get.mock.calls.map(([url]) => url))].sort()).toEqual([
      "/trips",
      "/trips/trip-1",
      "/trips/trip-1/memories",
    ]);
    expect(seen.every(Boolean)).toBe(true); // each went out during the refresh
    expect(apiClient.post.mock.calls.map(([url]) => url)).toEqual(["/trips/trip-1/memories"]); // the memory, not the photo
    expect((await pending(USER)).map((op) => op.op)).toEqual(["addPhoto"]);
    expect(store.getState().network).toMatchObject({ savedOnly: true, refreshing: false });
    expect(store.getState().timeline.savedAt).toBeTruthy(); // the bar's "saved copy from" is now
  });

  it("does nothing offline, or with the switch off", async () => {
    await makeStore({ savedOnly: true, online: false }).dispatch(refreshOnce());
    await makeStore().dispatch(refreshOnce());
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
