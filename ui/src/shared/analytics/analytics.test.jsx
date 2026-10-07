import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { pageFor, timelineViewPage } from "@/shared/analytics/pages";
import { resetAnalyticsForTests, setAnalytics, trackEvent, trackPageView } from "@/shared/analytics/umami";
import { useAnalyticsSetup, usePageViews } from "@/shared/analytics/useAnalytics";
import { getClientConfig } from "@/shared/services/clientConfig";

vi.mock("@/shared/services/clientConfig", () => ({ getClientConfig: vi.fn() }));

const CONFIG = { umamiUrl: "https://umami.example.com", umamiWebsiteId: "site-id" };
const TRIP = "11111111-2222-3333-4444-555555555555";

function umamiScript() {
  return document.head.querySelector('script[src="https://umami.example.com/script.js"]');
}

/** The tracker arriving: what Umami's script.js does when it loads. */
function loadTracker() {
  window.umami = { track: vi.fn() };
  act(() => {
    umamiScript().dispatchEvent(new Event("load"));
  });
  return window.umami.track;
}

/** The payload a `track(fn)` call would send, given the tracker's defaults. */
function sent(track, call = 0, defaults = { website: "site-id", url: "/real/address", title: "PriPriTrip", referrer: "" }) {
  return track.mock.calls[call][0](defaults);
}

beforeEach(() => {
  resetAnalyticsForTests();
  delete window.umami;
  vi.clearAllMocks();
});
afterEach(() => resetAnalyticsForTests());

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

describe("the tracker", () => {
  it("isn't loaded without an Umami address, and nothing is sent", () => {
    setAnalytics({ umamiUrl: null, umamiWebsiteId: null });
    trackPageView({ url: "/trips", title: "All trips", role: "none" });
    expect(document.head.querySelector("script[data-website-id]")).toBeNull();
  });

  it("is loaded once, with its own page tracking off", () => {
    setAnalytics(CONFIG);
    setAnalytics(CONFIG);
    expect(document.head.querySelectorAll("script[data-website-id]")).toHaveLength(1);
    const script = umamiScript();
    expect(script.dataset.websiteId).toBe("site-id");
    expect(script.dataset.hostUrl).toBe("https://umami.example.com");
    expect(script.dataset.autoTrack).toBe("false");
  });

  it("sends what was tracked before it loaded, with the role as tag and data", () => {
    setAnalytics(CONFIG);
    trackPageView({ url: "/trip/map", title: "Map", role: "viewer" });
    const track = loadTracker();
    expect(track).toHaveBeenCalledTimes(1);
    expect(sent(track)).toEqual({
      website: "site-id",
      url: "/trip/map",
      title: "Map",
      referrer: "",
      tag: "viewer",
      data: { role: "viewer" },
    });
  });

  it("drops a referrer from inside the app (it has ids), keeps one from outside", () => {
    setAnalytics(CONFIG);
    const track = loadTracker();
    trackEvent("packing-add", { url: "/trip/packing", role: "owner" });
    expect(sent(track, 0, { referrer: `/trips/${TRIP}` }).referrer).toBe("");
    expect(sent(track, 0, { referrer: "https://www.google.com/" }).referrer).toBe("https://www.google.com/");
    expect(sent(track, 0, {})).toMatchObject({ name: "packing-add", tag: "owner", data: { role: "owner" } });
  });

  it("sends nothing once it's turned off", () => {
    setAnalytics(CONFIG);
    const track = loadTracker();
    setAnalytics(null);
    trackPageView({ url: "/trips", title: "All trips", role: "none" });
    expect(track).not.toHaveBeenCalled();
  });

  it("never breaks the app if the tracker throws", () => {
    setAnalytics(CONFIG);
    const track = loadTracker();
    track.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => trackPageView({ url: "/trips", title: "All trips", role: "none" })).not.toThrow();
  });
});

// ---- page views as the app sends them ----

let navigateTo;
function Harness() {
  useAnalyticsSetup();
  usePageViews();
  navigateTo = useNavigate();
  return null;
}

function renderAt(path, { analytics = true, trip = { id: TRIP, role: "editor" } } = {}) {
  const timeline = createSlice({
    name: "timeline",
    initialState: { trip },
    reducers: { setTrip: (state, action) => ({ ...state, trip: action.payload }) },
  });
  const store = configureStore({
    reducer: {
      auth: (state = { token: "t", user: { id: "u1", analytics_enabled: analytics } }) => state,
      timeline: timeline.reducer,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Harness />
      </MemoryRouter>
    </Provider>
  );
  return { store, setTrip: (t) => act(() => store.dispatch(timeline.actions.setTrip(t))) };
}

describe("page views", () => {
  beforeEach(() => getClientConfig.mockResolvedValue(CONFIG));

  it("are sent with the page's name and the role on the trip", async () => {
    renderAt(`/trips/${TRIP}/map`);
    await waitFor(() => expect(umamiScript()).not.toBeNull());
    const track = loadTracker();
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    const payload = sent(track);
    expect(payload).toMatchObject({ url: "/trip/map", title: "Map", tag: "editor", data: { role: "editor" } });
    expect(JSON.stringify(payload)).not.toContain(TRIP);
  });

  it("count every navigation, the same page again included", async () => {
    renderAt(`/trips/${TRIP}/days/2026-10-30`);
    await waitFor(() => expect(umamiScript()).not.toBeNull());
    const track = loadTracker();
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    act(() => navigateTo(`/trips/${TRIP}/days/2026-10-31`));
    await waitFor(() => expect(track).toHaveBeenCalledTimes(2));
    expect(sent(track, 1)).toMatchObject({ url: "/trip/day" });
  });

  it("wait for the trip, so the role is known", async () => {
    const { setTrip } = renderAt(`/trips/${TRIP}/journal`, { trip: null });
    await waitFor(() => expect(umamiScript()).not.toBeNull());
    const track = loadTracker();
    await new Promise((r) => setTimeout(r, 400));
    expect(track).not.toHaveBeenCalled();
    setTrip({ id: TRIP, role: "owner" });
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    expect(sent(track)).toMatchObject({ url: "/trip/journal", tag: "owner" });
  });

  it("outside a trip have the role none", async () => {
    renderAt("/trips", { trip: null });
    await waitFor(() => expect(umamiScript()).not.toBeNull());
    const track = loadTracker();
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    expect(sent(track)).toMatchObject({ url: "/trips", tag: "none" });
  });

  it("only count where a redirect lands", async () => {
    renderAt(`/trips/${TRIP}/today`);
    await waitFor(() => expect(umamiScript()).not.toBeNull());
    const track = loadTracker();
    act(() => navigateTo(`/trips/${TRIP}`, { replace: true }));
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 400));
    expect(track).toHaveBeenCalledTimes(1);
    expect(sent(track)).toMatchObject({ url: "/trip/timeline" });
  });

  it("aren't sent, nor the tracker loaded, when the person's switch is off", async () => {
    renderAt(`/trips/${TRIP}/map`, { analytics: false });
    await new Promise((r) => setTimeout(r, 400));
    expect(getClientConfig).not.toHaveBeenCalled();
    expect(document.head.querySelector("script[data-website-id]")).toBeNull();
  });

  it("aren't sent for sign-in", async () => {
    renderAt("/login");
    await waitFor(() => expect(umamiScript()).not.toBeNull());
    const track = loadTracker();
    await new Promise((r) => setTimeout(r, 400));
    expect(track).not.toHaveBeenCalled();
  });
});
