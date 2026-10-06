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
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
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
const EDIT_CODE = "Xk3_pQ9vT2mLw8RzA1bC";
const VIEW_CODE = "VIEWcode_0000000000";
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
    await user.click(screen.getByRole("button", { name: "Stays" }));
    await user.click(document.querySelector("#day-2026-05-11 button"));
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

describe("the owner", () => {
  function ownerApi(members) {
    apiClient.get.mockImplementation(async (url) =>
      url.endsWith("/members")
        ? { data: members }
        : url.endsWith("/edit-code")
          ? { data: { code: EDIT_CODE } }
          : url.endsWith("/view-code")
            ? { data: { code: VIEW_CODE } }
            : { data: asOwner }
    );
  }

  it("shares a view code and an edit code, and shows who can do what", async () => {
    const user = userEvent.setup();
    ownerApi([
      { userId: "v1", email: "pripri@example.com", role: "editor", joinedAt: "2026-10-03T00:00:00Z" },
      { userId: "v2", email: "friend@example.com", role: "viewer", joinedAt: "2026-10-03T01:00:00Z" },
    ]);
    renderAt(`/trips/${TRIP_ID}`);
    await user.click(await screen.findByRole("button", { name: "Share trip" }));
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    const view = within(dialog).getByRole("region", { name: "Can view" });
    expect(await within(view).findByText(VIEW_CODE)).toBeInTheDocument();
    // The trip's id is in every URL, so it isn't a code any more.
    expect(within(dialog).queryByText(TRIP_ID)).not.toBeInTheDocument();
    expect(within(view).getByRole("button", { name: "Copy view code" })).toBeInTheDocument();
    const edit = within(dialog).getByRole("region", { name: "Can edit" });
    expect(await within(edit).findByText(EDIT_CODE)).toBeInTheDocument();
    expect(within(edit).getByRole("button", { name: "Copy edit code" })).toBeInTheDocument();

    const rows = within(dialog).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows[0]).toContain("pripri@example.com");
    expect(rows[0]).toContain("Can edit");
    expect(rows[1]).toContain("friend@example.com");
    expect(rows[1]).toContain("Can view");
  });

  it("makes a new edit code, with a second tap to confirm", async () => {
    const user = userEvent.setup();
    ownerApi([]);
    apiClient.post.mockResolvedValue({ data: { code: "NEWcode_000000000000" } });
    renderAt(`/trips/${TRIP_ID}`);
    await user.click(await screen.findByRole("button", { name: "Share trip" }));
    const edit = within(screen.getByRole("dialog", { name: "Share trip" })).getByRole("region", { name: "Can edit" });
    await within(edit).findByText(EDIT_CODE);

    await user.click(within(edit).getByRole("button", { name: "New edit code" }));
    expect(apiClient.post).not.toHaveBeenCalled();
    await user.click(within(edit).getByRole("button", { name: "Confirm a new edit code" }));
    expect(apiClient.post).toHaveBeenCalledWith(`/trips/${TRIP_ID}/edit-code`, null, { silent: true });
    expect(await within(edit).findByText("NEWcode_000000000000")).toBeInTheDocument();
    expect(within(edit).getByText(/The old one no longer works/)).toBeInTheDocument();
  });

  it("makes a new view code, with a second tap to confirm", async () => {
    const user = userEvent.setup();
    ownerApi([]);
    apiClient.post.mockResolvedValue({ data: { code: "NEWview_00000000000" } });
    renderAt(`/trips/${TRIP_ID}`);
    await user.click(await screen.findByRole("button", { name: "Share trip" }));
    const view = within(screen.getByRole("dialog", { name: "Share trip" })).getByRole("region", { name: "Can view" });
    await within(view).findByText(VIEW_CODE);
    await user.click(within(view).getByRole("button", { name: "New view code" }));
    await user.click(within(view).getByRole("button", { name: "Confirm a new view code" }));
    expect(apiClient.post).toHaveBeenCalledWith(`/trips/${TRIP_ID}/view-code`, null, { silent: true });
    expect(await within(view).findByText("NEWview_00000000000")).toBeInTheDocument();
  });

  it("removes someone, with a second tap to confirm", async () => {
    const user = userEvent.setup();
    ownerApi([{ userId: "v1", email: "pripri@example.com", role: "viewer", joinedAt: "2026-10-03T00:00:00Z" }]);
    apiClient.delete.mockResolvedValue({});
    renderAt(`/trips/${TRIP_ID}`);
    await user.click(await screen.findByRole("button", { name: "Share trip" }));
    const dialog = screen.getByRole("dialog", { name: "Share trip" });
    await user.click(await within(dialog).findByRole("button", { name: "Remove pripri@example.com" }));
    expect(apiClient.delete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm removing pripri@example.com" }));
    expect(apiClient.delete).toHaveBeenCalledWith(`/trips/${TRIP_ID}/members/v1`, { silent: true });
    expect(within(dialog).getByText("No one yet.")).toBeInTheDocument();
  });
});

describe("joining and leaving from the trips list", () => {
  it("joins with whatever code was pasted, trimmed, and opens the trip", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [] });
    apiClient.post.mockResolvedValue({ data: summary("viewer") });
    renderAt("/trips");
    await user.click(await screen.findByRole("button", { name: "Join trip" }));
    const dialog = screen.getByRole("dialog", { name: "Join a trip" });
    await user.type(within(dialog).getByLabelText("Trip code"), `  ${TRIP_ID} `);
    await user.click(within(dialog).getByRole("button", { name: "Join" }));
    expect(apiClient.post).toHaveBeenCalledWith("/trips/join", { code: TRIP_ID }, { silent: true });
    expect(await screen.findByText("today page")).toBeInTheDocument();
  });

  it("joins as an editor with the edit code", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [] });
    apiClient.post.mockResolvedValue({ data: summary("editor") });
    const store = renderAt("/trips");
    await user.click(await screen.findByRole("button", { name: "Join trip" }));
    await user.type(screen.getByLabelText("Trip code"), EDIT_CODE);
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(apiClient.post).toHaveBeenCalledWith("/trips/join", { code: EDIT_CODE }, { silent: true });
    expect(await screen.findByText("today page")).toBeInTheDocument();
    expect(store.getState().trips.items.map((t) => t.role)).toEqual(["editor"]);
  });

  it("says when no trip has that code", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [] });
    apiClient.post.mockRejectedValue({ response: { status: 404 } });
    renderAt("/trips");
    await user.click(await screen.findByRole("button", { name: "Join trip" }));
    await user.type(screen.getByLabelText("Trip code"), "wrong");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No trip has that code");
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
