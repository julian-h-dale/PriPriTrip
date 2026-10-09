import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { EntryPage } from "@/features/entry/EntryPage";
import { DayDetailPage } from "@/features/timeline/DayDetailPage";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
import { TripsPage } from "@/features/trips/TripsPage";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const TRIP_ID = "3f2b8c1e-1111-4222-8333-444455556666";
const base = { ...structuredClone(sampleTrip), id: TRIP_ID, createdAt: "2026-10-02T05:00:00Z" };
// Ids, as every trip read has them (an entry's page is found by its id).
base.stays.forEach((s, i) => (s.id = `stay-${i}`));
base.travels.forEach((t, i) => (t.id = `travel-${i}`));
base.days.forEach((d, i) => d.items.forEach((item, j) => (item.id = `item-${i}-${j}`)));
const asOwner = { ...base, role: "owner" };
const asViewer = { ...base, role: "viewer" };
const asEditor = { ...base, role: "editor" };
const summary = (role) => ({
  id: TRIP_ID,
  name: base.name,
  startDate: "2099-05-10",
  endDate: "2099-05-14",
  timezone: base.timezone,
  stayCount: 2,
  travelCount: 4,
  createdAt: base.createdAt,
  role,
});

function renderAt(path) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      trips: tripsReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: "t", user: { email: "u@x.com", is_superuser: false }, status: "idle" } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
          <Route path="/trips/:tripId/today" element={<div>today page</div>} />
          <Route path="/trips/:tripId/days/:date" element={<DayDetailPage />} />
          <Route path="/trips/:tripId/activities/:id" element={<EntryPage kind="activity" />} />
          <Route path="/trips/:tripId/stays/:id" element={<EntryPage kind="stay" />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(() => vi.clearAllMocks());

describe("a viewer", () => {
  it("sees a day with no edit controls at all", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: asViewer });
    renderAt(`/trips/${TRIP_ID}/days/2026-05-11`);
    await screen.findByRole("heading", { name: "Mon, May 11" });
    expect(screen.queryByRole("button", { name: /Add activity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /title and summary/ })).not.toBeInTheDocument();
    // No ⋯ to move things, and the activity's page has no Edit or Delete.
    expect(screen.queryByRole("button", { name: /^More for/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Lunch at Altes Tramdepot/ }));
    await screen.findByRole("article", { name: "Lunch at Altes Tramdepot" });
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("opens a stay's page with no Edit, and has no Share button", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: asViewer });
    renderAt(`/trips/${TRIP_ID}`);
    await screen.findByRole("heading", { name: base.name, level: 1 });
    expect(screen.queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
    // Not in the drawer either: a viewer gets no Trip tools at all.
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.queryByRole("region", { name: "Trip tools" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close menu" }));
    // Nor the Stays / Travel views: from the day, to the stay's page.
    expect(screen.queryByRole("group", { name: "Timeline view" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Mon, May 11/ }));
    await user.click(await screen.findByRole("link", { name: /Check in · Hotel Goldener/ }));
    await screen.findByRole("article", { name: "Hotel Goldener Schlüssel" });
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
  });
});

describe("an editor", () => {
  it("gets the edit controls on a day, but no Share button", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: asEditor });
    renderAt(`/trips/${TRIP_ID}/days/2026-05-11`);
    await screen.findByRole("heading", { name: "Mon, May 11" });
    expect(screen.getByRole("button", { name: /Add activity/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /title and summary/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Lunch at Altes Tramdepot/ }));
    await screen.findByRole("article", { name: "Lunch at Altes Tramdepot" });
    expect(screen.getByRole("button", { name: "Edit activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

/** Share is in the drawer (☰), after Documents. */
async function openShare(user) {
  await user.click(await screen.findByRole("button", { name: "Open menu" }));
  const tools = screen.getByRole("region", { name: "Trip tools" });
  await user.click(await within(tools).findByRole("button", { name: "Share trip" }));
}

describe("the owner", () => {
  function ownerApi(members) {
    apiClient.get.mockImplementation(async (url) => (url.endsWith("/members") ? { data: members } : { data: asOwner }));
  }
  const PRIPRI = { userId: "v1", email: "pripri@example.com", name: "PriPri", role: "editor", joinedAt: "2026-10-03T00:00:00Z" };
  const FRIEND = { userId: "v2", email: "friend@example.com", name: "", role: "viewer", joinedAt: "2026-10-03T01:00:00Z" };

  it("shows who's on the trip, by name, with their role, and no codes", async () => {
    const user = userEvent.setup();
    ownerApi([PRIPRI, FRIEND]);
    renderAt(`/trips/${TRIP_ID}`);
    await openShare(user);
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    const rows = await within(dialog).findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("PriPri");
    expect(rows[0]).toHaveTextContent("pripri@example.com");
    expect(within(dialog).getByLabelText("Role for pripri@example.com")).toHaveValue("editor");
    expect(rows[1]).toHaveTextContent("friend@example.com");
    expect(within(dialog).getByLabelText("Role for friend@example.com")).toHaveValue("viewer");
    expect(within(dialog).queryByText(/code/i)).not.toBeInTheDocument();
  });

  it("invites someone by email as an editor", async () => {
    const user = userEvent.setup();
    ownerApi([]);
    apiClient.post.mockResolvedValue({ data: { ...PRIPRI } });
    renderAt(`/trips/${TRIP_ID}`);
    await openShare(user);
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    await within(dialog).findByText("No one yet.");
    await user.type(within(dialog).getByLabelText("Email"), " pripri@example.com ");
    await user.selectOptions(within(dialog).getByLabelText("Can"), "editor");
    await user.click(within(dialog).getByRole("button", { name: "Invite" }));
    expect(apiClient.post).toHaveBeenCalledWith(
      `/trips/${TRIP_ID}/members`,
      { email: "pripri@example.com", role: "editor" },
      { silent: true }
    );
    expect(await within(dialog).findByText("PriPri")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toHaveValue("");
  });

  it("says when no account has that email", async () => {
    const user = userEvent.setup();
    ownerApi([]);
    apiClient.post.mockRejectedValue({ response: { status: 404 } });
    renderAt(`/trips/${TRIP_ID}`);
    await openShare(user);
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    await user.type(within(dialog).getByLabelText("Email"), "nobody@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Invite" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No account with that email");
    expect(within(dialog).getByText("No one yet.")).toBeInTheDocument();
  });

  it("re-inviting someone changes their role in place", async () => {
    const user = userEvent.setup();
    ownerApi([FRIEND]);
    apiClient.post.mockResolvedValue({ data: { ...FRIEND, role: "editor" } });
    renderAt(`/trips/${TRIP_ID}`);
    await openShare(user);
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    await within(dialog).findByText("friend@example.com");
    await user.type(within(dialog).getByLabelText("Email"), "friend@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Can"), "editor");
    await user.click(within(dialog).getByRole("button", { name: "Invite" }));
    await vi.waitFor(() => expect(within(dialog).getByLabelText("Role for friend@example.com")).toHaveValue("editor"));
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
  });

  it("changes someone's role", async () => {
    const user = userEvent.setup();
    ownerApi([FRIEND]);
    apiClient.patch.mockResolvedValue({ data: { ...FRIEND, role: "editor" } });
    renderAt(`/trips/${TRIP_ID}`);
    await openShare(user);
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    await user.selectOptions(await within(dialog).findByLabelText("Role for friend@example.com"), "editor");
    expect(apiClient.patch).toHaveBeenCalledWith(`/trips/${TRIP_ID}/members/v2`, { role: "editor" }, { silent: true });
    expect(within(dialog).getByLabelText("Role for friend@example.com")).toHaveValue("editor");
  });

  it("puts the role back when the change fails", async () => {
    const user = userEvent.setup();
    ownerApi([FRIEND]);
    apiClient.patch.mockRejectedValue({ response: { status: 500 } });
    renderAt(`/trips/${TRIP_ID}`);
    await openShare(user);
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    await user.selectOptions(await within(dialog).findByLabelText("Role for friend@example.com"), "editor");
    await vi.waitFor(() => expect(within(dialog).getByLabelText("Role for friend@example.com")).toHaveValue("viewer"));
  });

  it("removes someone, with a second tap to confirm", async () => {
    const user = userEvent.setup();
    ownerApi([{ ...FRIEND, email: "pripri@example.com", userId: "v1" }]);
    apiClient.delete.mockResolvedValue({});
    renderAt(`/trips/${TRIP_ID}`);
    await openShare(user);
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    await user.click(await within(dialog).findByRole("button", { name: "Remove pripri@example.com" }));
    expect(apiClient.delete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm removing pripri@example.com" }));
    expect(apiClient.delete).toHaveBeenCalledWith(`/trips/${TRIP_ID}/members/v1`, { silent: true });
    expect(within(dialog).getByText("No one yet.")).toBeInTheDocument();
  });
});

describe("the trips list", () => {
  it("has no Join trip button any more", async () => {
    apiClient.get.mockResolvedValue({ data: [summary("owner")] });
    renderAt("/trips");
    expect(await screen.findByText(base.name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join trip" })).not.toBeInTheDocument();
  });

  it("marks a trip you can edit, and offers Leave (not Delete)", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [summary("editor")] });
    renderAt("/trips");
    expect(await screen.findByText("Shared with you · you can edit")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `More for ${base.name}` }));
    expect(screen.queryByRole("menuitem", { name: "Delete trip" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Leave trip" })).toBeInTheDocument();
  });

  it("marks a shared trip and offers Leave (not Delete)", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [summary("viewer")] });
    apiClient.delete.mockResolvedValue({});
    renderAt("/trips");
    expect(await screen.findByText("Shared with you")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `More for ${base.name}` }));
    expect(screen.queryByRole("menuitem", { name: "Delete trip" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Leave trip" }));
    await user.click(within(screen.getByRole("dialog", { name: "Leave trip?" })).getByRole("button", { name: "Leave" }));
    expect(apiClient.delete).toHaveBeenCalledWith(`/trips/${TRIP_ID}/membership`, { silent: true });
    await vi.waitFor(() => expect(screen.queryByText(base.name)).not.toBeInTheDocument());
  });
});
