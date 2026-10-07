import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { pageFor, timelineViewPage } from "@/shared/analytics/pages";
import {
  flush,
  forgetAnalytics,
  rememberedSettings,
  resetAnalyticsForTests,
  setAnalytics,
  trackEvent,
  trackPageView,
} from "@/shared/analytics/umami";
import { useAnalyticsSetup, usePageViews } from "@/shared/analytics/useAnalytics";
import { getClientConfig } from "@/shared/services/clientConfig";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/clientConfig", () => ({ getClientConfig: vi.fn() }));

const CONFIG = { umamiUrl: "https://umami.example.com", umamiWebsiteId: "site-id" };
const TRIP = "11111111-2222-3333-4444-555555555555";
const USER = "user-1";

let fetchMock;
/** What reached Umami, in order: each request's payload. */
const sent = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).payload);
const answer = (status) => Promise.resolve({ status });
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(async () => {
  await resetAnalyticsForTests();
  localStorage.clear();
  vi.clearAllMocks();
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => answer(200));
});
afterEach(() => fetchMock.mockRestore());

describe("page names", () => {
  it("are the route's name, never its address", () => {
    expect(pageFor(`/trips/${TRIP}/map`)).toEqual({ url: "/trip/map", title: "Map", tripId: TRIP });
    expect(pageFor(`/trips/${TRIP}`)).toMatchObject({ url: "/trip/timeline" });
    expect(pageFor(`/trips/${TRIP}/days/2026-10-30`)).toMatchObject({ url: "/trip/day" });
    expect(pageFor(`/trips/${TRIP}/activities/abc`)).toMatchObject({ url: "/trip/activity" });
    expect(pageFor(`/trips/${TRIP}/time`)).toMatchObject({ url: "/trip/timezones", title: "Time zones" });
    expect(pageFor("/trips")).toEqual({ url: "/trips", title: "All trips", tripId: null });
    expect(pageFor("/admin")).toMatchObject({ url: "/admin" });
    expect(timelineViewPage("stays")).toEqual({ url: "/trip/timeline/stays", title: "Timeline: Stays" });
  });

  it("leave out sign-in and the redirect at /", () => {
    expect(pageFor("/login")).toBeNull();
    expect(pageFor("/")).toBeNull();
  });
});

describe("sending to Umami", () => {
  it("posts what the tracker would, with the time it happened and no cache token", async () => {
    await setAnalytics(CONFIG, USER);
    trackPageView({ url: "/trip/map", title: "Map", role: "viewer" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://umami.example.com/api/send");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(init.body).type).toBe("event");
    expect(sent()[0]).toMatchObject({
      website: "site-id",
      url: "/trip/map",
      title: "Map",
      tag: "viewer",
      data: { role: "viewer" },
      hostname: window.location.hostname,
    });
    expect(Math.abs(sent()[0].timestamp - Date.now() / 1000)).toBeLessThan(5);
  });

  it("names events, with the role and their details", async () => {
    await setAnalytics(CONFIG, USER);
    trackEvent("packing-add", { url: "/trip/packing", role: "owner", from: "typed" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent()[0]).toMatchObject({ name: "packing-add", tag: "owner", data: { role: "owner", from: "typed" } });
  });

  it("holds what happens before it's known whether to count, then sends it", async () => {
    trackPageView({ url: "/trips", title: "All trips", role: "none" });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    await setAnalytics(CONFIG, USER);
    await waitFor(() => expect(sent().map((p) => p.url)).toEqual(["/trips"]));
  });

  it("drops it all when this person isn't counted", async () => {
    trackPageView({ url: "/trips", title: "All trips", role: "none" });
    await setAnalytics(null);
    trackPageView({ url: "/trip/map", title: "Map", role: "owner" });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isn't on without an Umami address", async () => {
    await setAnalytics({ umamiUrl: null, umamiWebsiteId: null }, USER);
    trackPageView({ url: "/trips", title: "All trips", role: "none" });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("offline", () => {
  it("keeps events on the phone, then sends them oldest first, with their own times", async () => {
    fetchMock.mockImplementation(offline);
    const clock = vi.spyOn(Date, "now");
    await setAnalytics(CONFIG, USER);
    clock.mockReturnValue(Date.parse("2026-10-07T09:00:00Z"));
    trackPageView({ url: "/trip/map", title: "Map", role: "owner" });
    clock.mockReturnValue(Date.parse("2026-10-07T09:05:00Z"));
    trackEvent("packing-check", { url: "/trip/packing", role: "owner" });
    await new Promise((r) => setTimeout(r, 50));
    clock.mockRestore();

    fetchMock.mockClear();
    fetchMock.mockImplementation(() => answer(200));
    await flush();
    expect(sent().map((p) => [p.url, p.timestamp])).toEqual([
      ["/trip/map", Date.parse("2026-10-07T09:00:00Z") / 1000],
      ["/trip/packing", Date.parse("2026-10-07T09:05:00Z") / 1000],
    ]);
    fetchMock.mockClear();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled(); // sent once only
  });

  it("sends when the connection comes back", async () => {
    fetchMock.mockImplementation(offline);
    await setAnalytics(CONFIG, USER);
    trackPageView({ url: "/trip/journal", title: "Journal", role: "editor" });
    await new Promise((r) => setTimeout(r, 50));
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => answer(200));
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(sent().map((p) => p.url)).toEqual(["/trip/journal"]));
  });

  it("drops an event Umami refuses, keeps one it couldn't take (5xx)", async () => {
    fetchMock.mockImplementation(() => answer(503));
    await setAnalytics(CONFIG, USER);
    trackPageView({ url: "/trip/map", title: "Map", role: "owner" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => answer(400));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); // still there; refused this time
    fetchMock.mockClear();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled(); // and gone
  });

  it("lets go of anything over 30 days old", async () => {
    fetchMock.mockImplementation(offline);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 31 * 24 * 3600 * 1000);
    await setAnalytics(CONFIG, USER);
    trackPageView({ url: "/trip/map", title: "Map", role: "owner" });
    await new Promise((r) => setTimeout(r, 50));
    clock.mockRestore();
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => answer(200));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forgetting someone drops their queue and their remembered switch", async () => {
    fetchMock.mockImplementation(offline);
    await setAnalytics(CONFIG, USER);
    expect(rememberedSettings(USER)).toEqual(CONFIG);
    trackPageView({ url: "/trip/map", title: "Map", role: "owner" });
    await new Promise((r) => setTimeout(r, 50));
    await forgetAnalytics(USER);
    expect(rememberedSettings(USER)).toBeNull();
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => answer(200));
    await setAnalytics(CONFIG, USER);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---- as the app uses it ----

let navigateTo;
function Harness() {
  useAnalyticsSetup();
  usePageViews();
  navigateTo = useNavigate();
  return null;
}

function renderAt(path, { analytics = true, user = true, trip = { id: TRIP, role: "editor" } } = {}) {
  const timeline = createSlice({
    name: "timeline",
    initialState: { trip },
    reducers: { setTrip: (state, action) => ({ ...state, trip: action.payload }) },
  });
  const auth = { token: fakeToken(USER), user: user ? { id: USER, analytics_enabled: analytics } : null };
  const store = configureStore({ reducer: { auth: (state = auth) => state, timeline: timeline.reducer } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Harness />
      </MemoryRouter>
    </Provider>
  );
  return { setTrip: (t) => act(() => store.dispatch(timeline.actions.setTrip(t))) };
}

describe("page views", () => {
  beforeEach(() => getClientConfig.mockResolvedValue(CONFIG));

  it("are sent with the page's name and the role on the trip, never an id", async () => {
    renderAt(`/trips/${TRIP}/map`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent()[0]).toMatchObject({ url: "/trip/map", title: "Map", tag: "editor", data: { role: "editor" } });
    expect(JSON.stringify(sent())).not.toContain(TRIP);
  });

  it("count every navigation, the same page again included", async () => {
    renderAt(`/trips/${TRIP}/days/2026-10-30`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => navigateTo(`/trips/${TRIP}/days/2026-10-31`));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent()[1]).toMatchObject({ url: "/trip/day" });
  });

  it("wait for the trip, so the role is known", async () => {
    const { setTrip } = renderAt(`/trips/${TRIP}/journal`, { trip: null });
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
    setTrip({ id: TRIP, role: "owner" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent()[0]).toMatchObject({ url: "/trip/journal", tag: "owner" });
  });

  it("outside a trip have the role none", async () => {
    renderAt("/trips", { trip: null });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent()[0]).toMatchObject({ url: "/trips", tag: "none" });
  });

  it("only count where a redirect lands", async () => {
    renderAt(`/trips/${TRIP}/today`);
    act(() => navigateTo(`/trips/${TRIP}`, { replace: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 400));
    expect(sent().map((p) => p.url)).toEqual(["/trip/timeline"]);
  });

  it("aren't sent for sign-in", async () => {
    renderAt("/login");
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aren't sent when the person's switch is off, and what was waiting is dropped", async () => {
    localStorage.setItem(`analytics:${USER}`, JSON.stringify(CONFIG)); // on, last time
    renderAt(`/trips/${TRIP}/map`, { analytics: false });
    await new Promise((r) => setTimeout(r, 400));
    expect(getClientConfig).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rememberedSettings(USER)).toBeNull();
  });

  it("opened offline, the switch remembered on the phone still counts them", async () => {
    localStorage.setItem(`analytics:${USER}`, JSON.stringify(CONFIG));
    fetchMock.mockImplementation(offline);
    renderAt(`/trips/${TRIP}/map`, { user: false }); // /users/me can't load
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // tried, kept
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => answer(200));
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(sent().map((p) => p.url)).toEqual(["/trip/map"]));
  });

  it("opened offline with nothing remembered, nothing is sent", async () => {
    renderAt(`/trips/${TRIP}/map`, { user: false });
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
