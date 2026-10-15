import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { TripSettingsPage } from "@/features/trips/TripSettingsPage";
import { exportFilename } from "@/features/trips/tripSettings";
import { NotForViewers } from "@/shared/components/NotForViewers";
import { apiClient } from "@/shared/services/apiClient";
import { saveToPhone } from "@/features/journal/saveToPhone";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import { nearbyRadius, openOn } from "@/shared/phoneSettings";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/features/journal/saveToPhone", () => ({ saveToPhone: vi.fn() }));

const TRIP = {
  id: "t1",
  name: "Bern & Wengen",
  startDate: "2099-05-10",
  endDate: "2099-05-14",
  timezone: "Europe/Zurich",
  createdAt: "2026-10-02T05:00:00Z",
  stays: [],
  travels: [],
  days: [],
  role: "owner",
};
const photo = (id) => ({ id, width: 4, height: 3, thumbUrl: `/photos/${id}/thumb`, displayUrl: "", originalUrl: "" });
const MEMORIES = [
  { id: "m1", text: "public", zone: "UTC", createdAt: "2099-05-10T10:00:00Z", isPublic: true, photos: [photo("p1"), photo("p2")] },
  { id: "m2", text: "private", zone: "UTC", createdAt: "2099-05-10T11:00:00Z", isPublic: false, photos: [photo("p3")] },
];
const MEMBERS = [{ userId: "u2", email: "pripri@example.com", name: "PriPri", role: "editor", joinedAt: "2026-10-01T00:00:00Z" }];

function serve(trip) {
  apiClient.get.mockImplementation(async (url) => {
    if (url === "/trips/t1") return { data: trip };
    if (url === "/trips/t1/memories") return { data: MEMORIES };
    if (url === "/trips/t1/members") return { data: MEMBERS };
    if (url === "/trips/t1/link") return { data: { enabled: false, secret: null } };
    if (url === "/trips/t1/export") return { data: new Blob(["{}"]) };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderPage({ trip = TRIP, online = true } = {}) {
  serve(trip);
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      trips: tripsReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: {
      auth: { token: fakeToken("user-1"), user: null, status: "idle" },
      network: { online },
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/trips/t1/settings"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route
            path="/trips/:tripId/settings"
            element={
              <NotForViewers>
                <TripSettingsPage />
              </NotForViewers>
            }
          />
          <Route path="/trips/:tripId" element={<p>timeline page</p>} />
          <Route path="/trips" element={<p>trips list</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

const section = (name) => screen.findByRole("region", { name });

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await clearAll();
  apiClient.patch.mockImplementation(async (_url, changes) => ({ data: { ...TRIP, coverEmoji: null, coverThumbUrl: null, ...changes } }));
});

describe("TripSettingsPage (Run stage 29)", () => {
  it("the owner gets cover, name, people, export and delete, in that order", async () => {
    renderPage();
    await section("Cover");
    const names = screen
      .getAllByRole("region")
      .map((r) => r.getAttribute("aria-label") ?? document.getElementById(r.getAttribute("aria-labelledby")).textContent);
    expect(names).toEqual(["Cover", "Name", "On this phone", "People", "Shared with", "Link sharing", "Export", "Delete trip"]);
    expect(await screen.findByText("PriPri")).toBeInTheDocument();
  });

  it("an editor gets no People, and Leave instead of Delete", async () => {
    renderPage({ trip: { ...TRIP, role: "editor" } });
    await section("Cover");
    expect(screen.queryByRole("region", { name: "People" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Leave trip" })).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/trips/t1/members", expect.anything());
  });

  it("a viewer is sent back to the trip", async () => {
    renderPage({ trip: { ...TRIP, role: "viewer" } });
    expect(await screen.findByText("timeline page")).toBeInTheDocument();
  });

  it("renames: Save waits for a change, then saves it for everyone", async () => {
    const user = userEvent.setup();
    const store = renderPage();
    const name = await screen.findByLabelText("Trip name");
    const saveButton = within(await section("Name")).getByRole("button", { name: "Save" });
    expect(name).toHaveValue("Bern & Wengen");
    expect(saveButton).toBeDisabled();
    await user.clear(name);
    expect(saveButton).toBeDisabled(); // blank won't save
    await user.type(name, "Swiss Alps");
    await user.click(saveButton);
    expect(apiClient.patch).toHaveBeenCalledWith("/trips/t1", { name: "Swiss Alps" }, { silent: true });
    await waitFor(() => expect(store.getState().timeline.trip.name).toBe("Swiss Alps"));
    expect(await screen.findByLabelText("Trip name")).toHaveValue("Swiss Alps");
  });

  it("shows the server's refusal next to the name", async () => {
    const user = userEvent.setup();
    apiClient.patch.mockRejectedValue({ response: { status: 422, data: { detail: [{ msg: "Value error, A trip needs a name" }] } } });
    renderPage();
    const name = await screen.findByLabelText("Trip name");
    await user.type(name, "!");
    await user.click(within(await section("Name")).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A trip needs a name");
  });

  it("offline, the name, the cover and the export wait for a connection", async () => {
    renderPage({ online: false });
    expect(await screen.findByLabelText("Trip name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use 🏔️" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download this trip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete trip" })).toBeDisabled();
  });

  it("picks an emoji, or types one", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Use 🏔️" }));
    expect(apiClient.patch).toHaveBeenCalledWith("/trips/t1", { coverEmoji: "🏔️" }, { silent: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Use 🏔️" })).toHaveAttribute("aria-pressed", "true"));
    await user.type(screen.getByLabelText("Or type one"), "🦙");
    await user.click(screen.getByRole("button", { name: "Use" }));
    expect(apiClient.patch).toHaveBeenLastCalledWith("/trips/t1", { coverEmoji: "🦙" }, { silent: true });
  });

  it("offers only photos from memories everyone can see, and removes a cover", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Photo" }));
    expect(screen.getByText("Only photos from memories everyone can see.")).toBeInTheDocument();
    const photos = await screen.findByRole("list", { name: "Photos" });
    expect(within(photos).getAllByRole("button")).toHaveLength(2); // p3 is on a private memory
    apiClient.patch.mockResolvedValueOnce({ data: { ...TRIP, coverEmoji: null, coverThumbUrl: "/photos/p2/thumb" } });
    await user.click(within(photos).getByRole("button", { name: "Use photo 2" }));
    expect(apiClient.patch).toHaveBeenCalledWith("/trips/t1", { coverPhotoId: "p2" }, { silent: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Use photo 2" })).toHaveAttribute("aria-pressed", "true"));

    await user.click(screen.getByRole("button", { name: "Remove cover" }));
    expect(apiClient.patch).toHaveBeenLastCalledWith("/trips/t1", { coverEmoji: null, coverPhotoId: null }, { silent: true });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove cover" })).not.toBeInTheDocument());
  });

  it("on this phone: opens on, distances and the radius, offline too, saved on the phone only", async () => {
    const user = userEvent.setup();
    renderPage({ online: false });
    const phone = await section("On this phone");
    const group = (name) => within(phone).getByRole("radiogroup", { name });
    // An upcoming trip opens on Today until this phone says otherwise.
    expect(within(group("Opens on")).getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(group("Opens on")).getByRole("radio", { name: "Map" }));
    expect(openOn("t1")).toBe("map");
    expect(within(group("Opens on")).getByRole("radio", { name: "Map" })).toHaveAttribute("aria-checked", "true");

    const radius = () => group("Nearby points of interest, within");
    expect(within(radius()).getByRole("radio", { name: "½ mi" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(radius()).getByRole("radio", { name: "1 mi" }));
    expect(nearbyRadius("t1", "mi").label).toBe("1 mi");

    // Kilometres: the radius's steps change with it, to the nearest one.
    await user.click(within(group("Distances (every trip)")).getByRole("radio", { name: "Kilometres" }));
    expect(within(radius()).getByRole("radio", { name: "2 km" })).toHaveAttribute("aria-checked", "true");
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it("the secret link: on, copy, a new link, off (Run stage 31)", async () => {
    const user = userEvent.setup();
    renderPage();
    const sharing = await screen.findByRole("region", { name: "Link sharing" });
    const toggle = await within(sharing).findByRole("switch", { name: "Anyone with the link can view" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    apiClient.post.mockResolvedValueOnce({ data: { enabled: true, secret: "s3cret" } });
    await user.click(toggle);
    expect(apiClient.post).toHaveBeenCalledWith("/trips/t1/link");
    expect(await within(sharing).findByText(`${window.location.origin}/s/s3cret`)).toBeInTheDocument();
    expect(within(sharing).getByRole("button", { name: "Copy link" })).toBeInTheDocument();

    // A new link, after saying what happens to the old one.
    await user.click(within(sharing).getByRole("button", { name: "Make a new link" }));
    const rotate = screen.getByRole("dialog", { name: "Make a new link?" });
    expect(rotate).toHaveTextContent("The current link stops working");
    apiClient.post.mockResolvedValueOnce({ data: { enabled: true, secret: "fresh" } });
    await user.click(within(rotate).getByRole("button", { name: "Make a new link" }));
    expect(apiClient.post).toHaveBeenLastCalledWith("/trips/t1/link/rotate");
    expect(await within(sharing).findByText(`${window.location.origin}/s/fresh`)).toBeInTheDocument();

    // Off, also confirmed.
    await user.click(within(sharing).getByRole("switch"));
    apiClient.delete.mockResolvedValueOnce({});
    await user.click(within(screen.getByRole("dialog", { name: "Turn off the link?" })).getByRole("button", { name: "Turn off" }));
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/t1/link");
    await waitFor(() => expect(within(sharing).getByRole("switch")).toHaveAttribute("aria-checked", "false"));
    expect(within(sharing).queryByText(/\/s\//)).not.toBeInTheDocument();
  });

  it("downloads the trip as a file named after it", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Download this trip" }));
    await waitFor(() => expect(saveToPhone).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledWith("/trips/t1/export", { responseType: "blob", silent: true });
    expect(saveToPhone.mock.calls[0][0].name).toBe("bern-wengen.json");
    expect(exportFilename("¡¡¡")).toBe("trip.json");
  });

  it("delete asks first, then goes back to the trips list", async () => {
    const user = userEvent.setup();
    apiClient.delete.mockResolvedValue({});
    renderPage();
    await user.click(within(await section("Delete trip")).getByRole("button", { name: "Delete trip" }));
    const dialog = screen.getByRole("dialog", { name: "Delete trip?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/t1", { silent: true });
    expect(await screen.findByText("trips list")).toBeInTheDocument();
  });

  it("an editor leaves the trip", async () => {
    const user = userEvent.setup();
    apiClient.delete.mockResolvedValue({});
    renderPage({ trip: { ...TRIP, role: "editor" } });
    await user.click(within(await section("Leave trip")).getByRole("button", { name: "Leave trip" }));
    await user.click(within(screen.getByRole("dialog", { name: "Leave trip?" })).getByRole("button", { name: "Leave" }));
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/t1/membership", { silent: true });
    expect(await screen.findByText("trips list")).toBeInTheDocument();
  });
});
