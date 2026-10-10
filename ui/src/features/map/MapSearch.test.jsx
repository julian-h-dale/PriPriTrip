import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { MapPage } from "@/features/map/MapPage";
import { apiClient } from "@/shared/services/apiClient";
import { createPlacesSearch } from "@/shared/services/googlePlaces";
import { glyphSrcFor, NEW_PLACE_GLYPH_SRC } from "@/features/map/mapStyle";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/shared/services/geolocation", () => ({
  geolocationAvailable: () => true,
  permissionState: vi.fn(async () => "prompt"),
  currentPosition: vi.fn(async () => null),
  watchPosition: vi.fn(),
}));
vi.mock("@/shared/services/googlePlaces", () => ({
  createPlacesSearch: vi.fn(),
  PlacesUnavailable: class PlacesUnavailable extends Error {},
}));

// --- A fake Google Maps: just enough of maps/marker for MapPage. -----------
const fake = vi.hoisted(() => ({ markers: [], circles: [], map: null, infoWindow: null }));
vi.mock("@/shared/services/googleMapsLoader", () => {
  class FakeMap {
    constructor() {
      fake.map = this;
      this.panTo = vi.fn();
      this.panBy = vi.fn();
      this.setCenter = vi.fn();
      this.setZoom = vi.fn();
      this.fitBounds = vi.fn();
    }
    getBounds() {
      return { toJSON: () => ({ north: 47, south: 46, east: 8, west: 7 }) };
    }
  }
  class FakeInfoWindow {
    constructor() {
      fake.infoWindow = this;
      this.node = null;
    }
    addListener() {}
    // Google attaches the content node into the page; so does the fake.
    setContent(node) {
      this.node = node;
      if (!node.isConnected) document.body.appendChild(node);
    }
    open() {}
    close() {}
  }
  class FakeAdvancedMarker {
    constructor(opts) {
      Object.assign(this, opts);
      this.listeners = {};
      fake.markers.push(this);
    }
    addListener(type, fn) {
      this.listeners[type] = fn;
    }
  }
  class FakeCircle {
    constructor(opts) {
      Object.assign(this, opts);
      fake.circles.push(this);
    }
    setCenter(c) {
      this.center = c;
    }
    setRadius(r) {
      this.radius = r;
    }
    setMap(m) {
      this.map = m;
    }
  }
  class FakePin {
    constructor(opts) {
      Object.assign(this, opts);
    }
  }
  return {
    loadGoogleMapsLibrary: vi.fn(async (name) =>
      name === "maps"
        ? { Map: FakeMap, InfoWindow: FakeInfoWindow, Circle: FakeCircle }
        : { AdvancedMarkerElement: FakeAdvancedMarker, PinElement: FakePin }
    ),
    GoogleMapsUnavailable: class extends Error {},
  };
});

const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", createdAt: "2026-10-02T05:00:00Z" };
// Give the sample's stays ids and place ids, as a real trip read would have.
TRIP.stays = TRIP.stays.map((s, i) => ({ ...s, id: `stay-${i}`, location: { ...s.location, placeId: `saved-${i}` } }));
TRIP.travels = TRIP.travels.map((t, i) => ({ ...t, id: `travel-${i}` }));
TRIP.days = TRIP.days.map((d) => ({ ...d, items: d.items.map((it, i) => ({ ...it, id: `${d.date}-${i}` })) }));

const CAFE = { placeId: "cafe-1", name: "Café Fédéral", address: "Bärenplatz 31, Bern", city: "Bern", lat: 46.947, lng: 7.443, types: ["cafe", "food", "establishment"] };
const SAVED_HOTEL = { placeId: "saved-0", primary: TRIP.stays[0].name, secondary: "Bern" };
const BERN = { placeId: "bern", name: "Bern", lat: 46.948, lng: 7.447, types: ["locality", "political"] };

// One journal memory with a location (a pin), one without (no pin).
const MEMORIES = [
  { id: "mem-1", text: "Fondue was huge", zone: "Europe/Zurich", createdAt: "2026-05-11T18:00:00Z", location: { lat: 46.948, lng: 7.447, accuracy: 10 }, authorEmail: "pripri@example.com", mine: false },
  { id: "mem-2", text: "No place", zone: "Europe/Zurich", createdAt: "2026-05-11T19:00:00Z", location: null, authorEmail: "u@x.com", mine: true },
];

const fakeSearch = {
  suggest: vi.fn(async (input) => {
    const all = [SAVED_HOTEL, { placeId: CAFE.placeId, primary: CAFE.name, secondary: CAFE.address }, { placeId: "bern", primary: "Bern", secondary: "Switzerland" }];
    return all.filter((s) => s.primary.toLowerCase().includes(input.toLowerCase()));
  }),
  pick: vi.fn(async (s) => ({ ...[CAFE, BERN].find((p) => p.placeId === s.placeId) })),
};

/** The router's current query string, so a test can see the map drop ?focus. */
function SearchProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderMap({ online = true, path = "/trips/trip-1/map" } = {}) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { network: { online } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route
            path="/trips/:tripId/map"
            element={
              <>
                <MapPage />
                <SearchProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.google = {
    maps: {
      LatLngBounds: class {
        points = [];
        extend(point) {
          this.points.push(point);
        }
      },
    },
  };
  fake.markers = [];
  fake.circles = [];
  document.body.innerHTML = "";
  createPlacesSearch.mockResolvedValue(fakeSearch);
  apiClient.get.mockImplementation(async (url) => {
    if (url === "/config") return { data: { googleMapsApiKey: "k", googleMapsMapId: "m" } };
    if (url === "/trips/trip-1") return { data: TRIP };
    if (url === "/timezone") return { data: { timezone: "Europe/Zurich" } };
    if (url === "/trips/trip-1/memories") return { data: MEMORIES };
    throw new Error(`unexpected GET ${url}`);
  });
});

async function search(text) {
  const box = await screen.findByRole("combobox", { name: "Search trip or places" });
  await userEvent.type(box, text);
  return screen.findByRole("listbox", { name: "Matching places" });
}

describe("map search with Google places", () => {
  it("lists trip matches first, then new places marked New, dropping one the trip already has", async () => {
    renderMap();
    // "Hotel" matches the trip's own hotels; Google also suggests the saved one.
    const list = await search(TRIP.stays[0].name.slice(0, 5));
    await within(list).findByText("On this trip");
    // The saved hotel shows once (trip section), never again as "New".
    // Google is asked (biased to what the map shows) once the typing settles…
    await waitFor(() =>
      expect(fakeSearch.suggest).toHaveBeenCalledWith(expect.any(String), { north: 47, south: 46, east: 8, west: 7 })
    );
    // …but the saved hotel still shows once (trip section), never again as "New".
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(within(list).getAllByText(TRIP.stays[0].name)).toHaveLength(1);
    expect(within(list).queryByText("New")).not.toBeInTheDocument();
  });

  it("picking a new place drops a marker, zooms there and offers the relevant Add actions", async () => {
    renderMap();
    const list = await search("Café");
    expect(await within(list).findByText("New places")).toBeInTheDocument();
    const row = within(list).getByRole("option", { name: /Café Fédéral/ });
    expect(within(row).getByText("New")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button"));

    expect(await screen.findByText("Not in this trip")).toBeInTheDocument();
    expect(fake.map.setZoom).toHaveBeenLastCalledWith(15);
    expect(fake.markers.at(-1).content.glyphSrc).toBe(NEW_PLACE_GLYPH_SRC);
    // A café: Add activity only, the rest behind More…
    expect(screen.getByRole("button", { name: "Add activity" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add stay" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More…" }));
    expect(screen.getByRole("button", { name: "Add stay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Travel to here" })).toBeInTheDocument();
  });

  it("Add activity opens the form prefilled with the place, and saving adds it to the trip", async () => {
    const saved = structuredClone(TRIP);
    saved.days[0].items.push({ id: "new-item", title: CAFE.name, location: { name: CAFE.name, lat: CAFE.lat, lng: CAFE.lng } });
    apiClient.post.mockResolvedValue({ data: saved });
    renderMap();
    const list = await search("Café");
    await userEvent.click(within(await within(list).findByRole("option", { name: /Café Fédéral/ })).getByRole("button"));
    await userEvent.click(await screen.findByRole("button", { name: "Add activity" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Café Fédéral");
    // Before the trip (or with no filter): the trip's first day.
    expect(within(dialog).getByLabelText("Day")).toHaveValue(TRIP.startDate);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/items",
      expect.objectContaining({
        title: "Café Fédéral",
        date: TRIP.startDate,
        location: expect.objectContaining({ name: "Café Fédéral", placeId: "cafe-1", lat: CAFE.lat }),
      }),
      expect.anything()
    );
    const body = apiClient.post.mock.calls[0][1];
    expect(body.location).not.toHaveProperty("types"); // Google's types never reach the API
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Not in this trip")).not.toBeInTheDocument(); // the search result is gone
  });

  it("a city only pans the map: no marker, nothing to add", async () => {
    renderMap();
    const list = await search("Bern");
    await userEvent.click(within(await within(list).findByRole("option", { name: /^Bern/ })).getByRole("button"));
    await waitFor(() => expect(fake.map.setZoom).toHaveBeenLastCalledWith(12));
    expect(fake.markers.some((m) => m.content.glyphSrc === NEW_PLACE_GLYPH_SRC)).toBe(false);
    expect(screen.queryByText("Not in this trip")).not.toBeInTheDocument();
  });

  it("Enter picks the first row (a trip match before any Google place)", async () => {
    renderMap();
    await search(TRIP.stays[0].name.slice(0, 5));
    await userEvent.keyboard("{Enter}");
    expect(fake.map.setZoom).toHaveBeenLastCalledWith(15);
    expect(await screen.findByText("View day")).toBeInTheDocument(); // a trip marker's info window
    expect(screen.queryByText("Not in this trip")).not.toBeInTheDocument();
  });

  it("without Google (no key or it failed), only trip matches show", async () => {
    createPlacesSearch.mockRejectedValue(new Error("no key"));
    renderMap();
    const list = await search(TRIP.stays[0].name.slice(0, 5));
    await waitFor(() => expect(createPlacesSearch).toHaveBeenCalled());
    expect(within(list).getByText("On this trip")).toBeInTheDocument();
    expect(within(list).queryByText("New places")).not.toBeInTheDocument();
  });
});

describe("memories and the blue dot on the map", () => {
  const MEMORY = glyphSrcFor({ kind: "memory" });
  const STAY = glyphSrcFor({ kind: "stay" });
  const shown = () => fake.markers.filter((m) => m.map !== null && m.content?.glyphSrc);
  const glyphs = () => shown().map((m) => m.content.glyphSrc);

  /** Pick a choice from the Filter menu. */
  async function filterTo(user, label) {
    await user.click(await screen.findByRole("button", { name: /^Filter the map/ }));
    await user.click(screen.getByRole("menuitemradio", { name: label }));
  }

  it("hides memories by default; the Filter's Journal shows only memories", async () => {
    const user = userEvent.setup();
    renderMap();
    const filter = await screen.findByRole("button", { name: "Filter the map" });
    await waitFor(() => expect(glyphs()).toContain(STAY));
    expect(glyphs()).not.toContain(MEMORY);
    // Journal and Stays are in the Filter's menu now, not buttons of their own.
    expect(screen.queryByRole("button", { name: "Show only memories" })).not.toBeInTheDocument();

    await filterTo(user, "Journal");
    await waitFor(() => expect(glyphs()).toContain(MEMORY));
    expect(glyphs()).toEqual([MEMORY]); // only the one memory with a location
    const pin = shown()[0];
    act(() => pin.listeners.click());
    expect(await screen.findByText("Fondue was huge")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open journal" })).toHaveAttribute("href", "/trips/trip-1/journal");

    await filterTo(user, "Everything");
    await waitFor(() => expect(glyphs()).not.toContain(MEMORY));
    expect(glyphs()).toContain(STAY);
    expect(filter).toHaveAccessibleName("Filter the map");
  });

  it("the Filter menu: one choice at a time, ticked; while on, the button is filled with its icon", async () => {
    const user = userEvent.setup();
    renderMap();
    await waitFor(() => expect(glyphs()).toContain(STAY));
    await user.click(screen.getByRole("button", { name: "Filter the map" }));
    const menu = screen.getByRole("menu", { name: "Show on the map" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Everything", "Stays", "Points of interest", "Journal"]);
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);

    await user.click(within(menu).getByRole("menuitemradio", { name: "Stays" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // closes on a choice
    const filter = screen.getByRole("button", { name: "Filter the map: Stays" });
    expect(filter.className).toMatch(/bg-primary/);
    await waitFor(() => expect(new Set(glyphs())).toEqual(new Set([STAY])));

    await filterTo(user, "Journal");
    expect(screen.getByRole("button", { name: "Filter the map: Journal" })).toBeInTheDocument();
    await waitFor(() => expect(glyphs()).toEqual([MEMORY]));

    // Escape or a tap elsewhere closes it without changing anything.
    await user.click(screen.getByRole("button", { name: /^Filter the map/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter the map: Journal" })).toBeInTheDocument();
  });

  it("follows the filters: a day fits that day's places, travel included; clearing goes back", async () => {
    const user = userEvent.setup();
    renderMap();
    await waitFor(() => expect(glyphs()).toContain(STAY));
    const lats = () => fake.map.fitBounds.mock.lastCall[0].points.map((p) => Math.round(p.lat));
    // Opened on the trip's places: the hotels, not Chicago.
    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
    expect(lats()).not.toContain(42);

    // The flight day: Chicago and Zürich airports, an ocean apart, is fine.
    fireEvent.change(screen.getByLabelText("Pick a day"), { target: { value: "2026-05-10" } });
    await waitFor(() => expect(fake.map.fitBounds).toHaveBeenCalledTimes(2));
    expect(new Set(lats())).toEqual(new Set([42, 47]));
    expect(fake.map.fitBounds.mock.lastCall[1]).toBe(48); // room for the pins

    // Clearing the day goes back to the trip's places.
    await user.click(screen.getByRole("button", { name: /Showing .* only; clear/ }));
    await waitFor(() => expect(fake.map.fitBounds).toHaveBeenCalledTimes(3));
    expect(lats()).not.toContain(42);

    // Journal: the one memory with a place, so centre on it.
    fake.map.setZoom.mockClear();
    await filterTo(user, "Journal");
    await waitFor(() => expect(fake.map.setZoom).toHaveBeenCalledWith(14));
    expect(fake.map.panTo).toHaveBeenLastCalledWith({ lat: 46.948, lng: 7.447 });
  });

  it("doesn't move the map when a filter leaves nothing, or on anything but a filter change", async () => {
    renderMap();
    await waitFor(() => expect(glyphs()).toContain(STAY));
    act(() => shown()[0].listeners.click()); // opening a pin's info isn't a filter change
    // A day with nothing on the map (before the trip): the view stays put.
    fireEvent.change(screen.getByLabelText("Pick a day"), { target: { value: "2026-05-09" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Showing .* only; clear/ })).toBeInTheDocument());
    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("locate me: asks, then shows a blue dot with an honest accuracy circle and follows it", async () => {
    const user = userEvent.setup();
    const { watchPosition } = await import("@/shared/services/geolocation");
    let emit;
    watchPosition.mockImplementation((onPosition) => {
      emit = onPosition;
      return () => {};
    });
    renderMap();
    await user.click(await screen.findByRole("button", { name: "Show where I am" }));
    expect(watchPosition).toHaveBeenCalledTimes(1);
    act(() => emit({ lat: 46.95, lng: 7.44, accuracy: 35 }));
    const me = fake.markers.find((m) => m.title === "You are here");
    expect(me.position).toEqual({ lat: 46.95, lng: 7.44 });
    expect(fake.circles[0]).toMatchObject({ radius: 35, center: { lat: 46.95, lng: 7.44 } });
    expect(fake.map.setZoom).toHaveBeenLastCalledWith(15); // centred on the first fix

    act(() => emit({ lat: 46.96, lng: 7.45, accuracy: 8 }));
    expect(me.position).toEqual({ lat: 46.96, lng: 7.45 });
    expect(fake.circles[0].radius).toBe(8);
    expect(fake.circles).toHaveLength(1);
  });

  it("starts on its own only when location is already allowed", async () => {
    const { permissionState, watchPosition } = await import("@/shared/services/geolocation");
    permissionState.mockResolvedValueOnce("granted");
    watchPosition.mockImplementation(() => () => {});
    renderMap();
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
  });
});


describe("points of interest on the map", () => {
  const MARKET = {
    id: "poi-1",
    name: "Bundesplatz market",
    category: "market",
    location: { name: "Bundesplatz", address: "Bundesplatz, 3011 Bern", lat: 46.9467, lng: 7.4442 },
    notes: "Tuesday and Saturday mornings.",
    version: 1,
  };
  const withPoi = (extra = {}) => ({ ...structuredClone(TRIP), pointsOfInterest: [MARKET], ...extra });
  function serveTrip(trip) {
    const base = apiClient.get.getMockImplementation();
    apiClient.get.mockImplementation(async (url) => (url === "/trips/trip-1" ? { data: trip } : base(url)));
  }
  const MARKET_GLYPH = glyphSrcFor({ kind: "poi", category: "market" });
  const poiPin = () => fake.markers.find((m) => m.map !== null && m.content?.glyphSrc === MARKET_GLYPH);

  it("a café from search is a point of interest first; the form guesses its kind and saves it", async () => {
    const user = userEvent.setup();
    const saved = { ...structuredClone(TRIP), pointsOfInterest: [{ ...MARKET, id: "poi-2", name: CAFE.name, category: "food" }] };
    apiClient.post.mockResolvedValue({ data: saved });
    renderMap();
    const list = await search("Café");
    await user.click(within(await within(list).findByRole("option", { name: /Café Fédéral/ })).getByRole("button"));
    const actions = (await screen.findByText("Not in this trip")).parentElement;
    const names = within(actions).getAllByRole("button").map((b) => b.textContent);
    expect(names.slice(0, 2)).toEqual(["Point of interest", "Add activity"]);

    await user.click(screen.getByRole("button", { name: "Point of interest" }));
    const dialog = await screen.findByRole("dialog", { name: "Add point of interest" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Café Fédéral");
    expect(within(dialog).getByLabelText("Kind")).toHaveValue("food");
    expect(within(dialog).queryByText(/Times here are/)).not.toBeInTheDocument(); // no clock: it has no times
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/points-of-interest",
      expect.objectContaining({
        name: "Café Fédéral",
        category: "food",
        location: expect.objectContaining({ placeId: "cafe-1", lat: CAFE.lat, lng: CAFE.lng }),
      }),
      expect.anything()
    );
    expect(apiClient.post.mock.calls[0][1].location).not.toHaveProperty("types");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Not in this trip")).not.toBeInTheDocument();
    await waitFor(() => expect(fake.markers.some((m) => m.map !== null && m.content?.glyphSrc === glyphSrcFor({ kind: "poi", category: "food" }))).toBe(true));
  });

  it("shows its own pin; its info window has its kind and notes, and Edit saves with its version", async () => {
    const user = userEvent.setup();
    serveTrip(withPoi());
    apiClient.put.mockResolvedValue({ data: withPoi({ pointsOfInterest: [{ ...MARKET, notes: "Saturdays", version: 2 }] }) });
    renderMap();
    await waitFor(() => expect(poiPin()).toBeTruthy());
    expect(poiPin().content.background).toBe("#199f70");
    act(() => poiPin().listeners.click());
    expect(await screen.findByText("Point of interest · Market")).toBeInTheDocument();
    expect(screen.getByText("Tuesday and Saturday mornings.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View day" })).not.toBeInTheDocument(); // on no day

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit point of interest" });
    expect(within(dialog).getByLabelText("Kind")).toHaveValue("market");
    await user.clear(within(dialog).getByLabelText("Notes"));
    await user.type(within(dialog).getByLabelText("Notes"), "Saturdays");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const [url, body, config] = apiClient.put.mock.calls[0];
    expect(url).toBe("/trips/trip-1/points-of-interest/poi-1");
    expect(body).toMatchObject({ name: "Bundesplatz market", category: "market", notes: "Saturdays" });
    expect(config.headers["If-Match"]).toBe('"1"');
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Delete asks first, then deletes it", async () => {
    const user = userEvent.setup();
    serveTrip(withPoi());
    apiClient.delete.mockResolvedValue({ data: structuredClone(TRIP) });
    renderMap();
    await waitFor(() => expect(poiPin()).toBeTruthy());
    act(() => poiPin().listeners.click());
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete point of interest?" });
    expect(confirm).toHaveTextContent("Bundesplatz market will be removed from the map for everyone");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/points-of-interest/poi-1", expect.objectContaining({ headers: { "If-Match": '"1"' } }));
    await waitFor(() => expect(poiPin()).toBeFalsy());
  });

  it("someone else's change (409): the form closes, a warning says who, the trip reloads", async () => {
    const user = userEvent.setup();
    serveTrip(withPoi());
    apiClient.put.mockRejectedValue({ response: { status: 409, data: { detail: { message: "Changed", version: 2, updatedByName: "PriPri" } } } });
    const store = renderMap();
    await waitFor(() => expect(poiPin()).toBeTruthy());
    act(() => poiPin().listeners.click());
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.stringify(store.getState().notification)).toContain("PriPri changed this");
  });

  it("a viewer sees it but gets no Edit or Delete", async () => {
    serveTrip(withPoi({ role: "viewer" }));
    renderMap();
    await waitFor(() => expect(poiPin()).toBeTruthy());
    act(() => poiPin().listeners.click());
    expect(await screen.findByText("Point of interest · Market")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("the map's search finds it, under On this trip; picking it opens its info window", async () => {
    const user = userEvent.setup();
    serveTrip(withPoi());
    renderMap();
    const list = await search("Bundesplatz");
    expect(await within(list).findByText("On this trip")).toBeInTheDocument();
    await user.click(within(within(list).getByRole("option", { name: /Bundesplatz market/ })).getByRole("button"));
    expect(await screen.findByText("Point of interest · Market")).toBeInTheDocument();
  });

  it("the Filter's Points of interest shows only them", async () => {
    const user = userEvent.setup();
    serveTrip(withPoi());
    renderMap();
    await waitFor(() => expect(poiPin()).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Filter the map" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Points of interest" }));
    await waitFor(() =>
      expect(fake.markers.filter((m) => m.map !== null && m.content?.glyphSrc).map((m) => m.content.glyphSrc)).toEqual([MARKET_GLYPH])
    );
    expect(screen.getByRole("button", { name: "Filter the map: Points of interest" })).toBeInTheDocument();
  });

  it("opened at its pin (?focus=): zooms there, opens its info window, then drops the parameter", async () => {
    serveTrip(withPoi());
    renderMap({ path: "/trips/trip-1/map?focus=poi-poi-1" });
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
    expect(fake.map.setZoom).toHaveBeenLastCalledWith(15);
    expect(fake.map.setCenter).toHaveBeenLastCalledWith({ lat: MARKET.location.lat, lng: MARKET.location.lng });
    expect(within(fake.infoWindow.node).getByText("Bundesplatz market")).toBeInTheDocument();
    expect(fake.map.fitBounds).not.toHaveBeenCalled(); // no trip-wide fit landing on top of it
  });

  it("an unknown ?focus= leaves the usual view and is dropped", async () => {
    serveTrip(withPoi());
    renderMap({ path: "/trips/trip-1/map?focus=poi-gone" });
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
    expect(fake.map.setZoom).not.toHaveBeenCalledWith(15);
  });

  it("on no day: picking a day hides it", async () => {
    const user = userEvent.setup();
    serveTrip(withPoi());
    renderMap();
    await waitFor(() => expect(poiPin()).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Pick a day"), { target: { value: "2026-05-11" } });
    await waitFor(() => expect(poiPin()).toBeFalsy());
    await user.click(screen.getByRole("button", { name: /Showing .* only; clear/ }));
    await waitFor(() => expect(poiPin()).toBeTruthy());
  });

  it("offline, the list of places has it, after the trip's days", async () => {
    serveTrip(withPoi());
    renderMap({ online: false });
    const list = await screen.findByRole("list", { name: "Places on this trip" });
    await within(list).findByText("Bundesplatz market"); // after the phone's saved copy, the trip as read
    const rows = within(list).getAllByRole("listitem");
    expect(rows.at(-1)).toHaveTextContent("Bundesplatz market");
    expect(rows.at(-1)).toHaveTextContent("Point of interest · Market");
  });
});

describe("the map's List button", () => {
  const openList = async (user) => {
    await user.click(await screen.findByRole("button", { name: "List what's on the map" }));
    return screen.getByRole("dialog", { name: "On the map" });
  };

  it("lists what the map shows, grouped, with icons; choosing one closes it and opens that pin", async () => {
    const user = userEvent.setup();
    renderMap();
    const dialog = await openList(user);
    const groups = within(dialog).getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(groups).toEqual(["Stays", "Activities", "Travel"]);
    // Every pin on the map is a row (the search result and "you are here" never are).
    const pins = fake.markers.filter((m) => m.map !== null && m.content?.glyphSrc);
    expect(within(dialog).getAllByRole("button").filter((b) => b.textContent !== "Close")).toHaveLength(pins.length);
    expect(within(within(dialog).getByRole("region", { name: "Travel" })).getAllByText("From Chicago O'Hare (ORD)")).toHaveLength(1);

    const hotel = within(within(dialog).getByRole("region", { name: "Stays" })).getByRole("button", { name: /Beausite Park Hotel/ });
    expect(hotel.querySelector("svg")).not.toBeNull(); // its kind's icon
    await user.click(hotel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.map.setZoom).toHaveBeenLastCalledWith(15);
    expect(fake.map.setCenter).toHaveBeenLastCalledWith({ lat: expect.any(Number), lng: expect.any(Number) });
    // Its info window: its name and its Details link (nothing to add from here).
    const card = fake.infoWindow.node;
    expect(within(card).getByText("Beausite Park Hotel")).toBeInTheDocument();
    expect(within(card).queryByText("Not in this trip")).not.toBeInTheDocument();
  });

  it("follows the Filter and the day; with nothing shown, it says so", async () => {
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole("button", { name: "Filter the map" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Stays" }));
    let dialog = await openList(user);
    expect(within(dialog).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Stays"]);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    // Stays on the morning of the last day: none covers that night.
    fireEvent.change(screen.getByLabelText("Pick a day"), { target: { value: TRIP.endDate } });
    dialog = await openList(user);
    expect(within(dialog).getByText("Nothing on the map with these filters.")).toBeInTheDocument();
  });

  it("points of interest have their own group, A–Z", async () => {
    const user = userEvent.setup();
    const pois = [
      { id: "p2", name: "Zytglogge clock shop", category: "shop", location: { name: "Zytglogge", lat: 46.948, lng: 7.448 }, version: 1 },
      { id: "p1", name: "Bundesplatz market", category: "market", location: { name: "Bundesplatz", lat: 46.946, lng: 7.444 }, version: 1 },
    ];
    const base = apiClient.get.getMockImplementation();
    apiClient.get.mockImplementation(async (url) =>
      url === "/trips/trip-1" ? { data: { ...structuredClone(TRIP), pointsOfInterest: pois } } : base(url)
    );
    renderMap();
    await waitFor(() => expect(fake.markers.some((m) => m.title === "Bundesplatz market" && m.map !== null)).toBe(true));
    const dialog = await openList(user);
    const group = within(dialog).getByRole("region", { name: "Points of interest" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("Bundesplatz market"),
      expect.stringContaining("Zytglogge clock shop"),
    ]);
  });
});

describe("a viewer's map", () => {
  it("the Filter offers Everything and Journal only", async () => {
    const user = userEvent.setup();
    const base = apiClient.get.getMockImplementation();
    apiClient.get.mockImplementation(async (url) =>
      url === "/trips/trip-1" ? { data: { ...structuredClone(TRIP), role: "viewer" } } : base(url)
    );
    renderMap();
    await user.click(await screen.findByRole("button", { name: "Filter the map" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual(["Everything", "Journal"]);
  });

  it("stays and legs the server sent without places get no pins; activities keep theirs", async () => {
    const asViewerReads = structuredClone(TRIP);
    asViewerReads.role = "viewer";
    asViewerReads.pointsOfInterest = [];
    asViewerReads.stays = asViewerReads.stays.map((s) => ({ ...s, location: { name: s.location.name, city: s.location.city } }));
    asViewerReads.travels = asViewerReads.travels.map((t) => ({ ...t, from: { name: t.from.name }, to: t.to && { name: t.to.name } }));
    const base = apiClient.get.getMockImplementation();
    apiClient.get.mockImplementation(async (url) => (url === "/trips/trip-1" ? { data: asViewerReads } : base(url)));
    renderMap();
    const activity = glyphSrcFor({ kind: "activity" });
    await waitFor(() => expect(fake.markers.some((m) => m.map !== null && m.content?.glyphSrc === activity)).toBe(true));
    const kinds = new Set(fake.markers.filter((m) => m.map !== null && m.content?.glyphSrc).map((m) => m.content.glyphSrc));
    expect(kinds).toEqual(new Set([activity]));
  });
});
