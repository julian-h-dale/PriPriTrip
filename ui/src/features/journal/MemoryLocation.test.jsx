import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { MemoryDialog } from "@/features/journal/MemoryDialog";
import { apiClient } from "@/shared/services/apiClient";
import { currentPosition, permissionState } from "@/shared/services/geolocation";
import { clearOutbox } from "@/shared/services/outbox";
import { fakeToken } from "@/test/fakeToken";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/shared/services/geolocation", () => ({
  geolocationAvailable: () => true,
  permissionState: vi.fn(),
  currentPosition: vi.fn(),
  watchPosition: vi.fn(() => () => {}),
}));

const USER = "user-1";
const TRIP = { ...structuredClone(sampleTrip), id: "trip-1", role: "owner" };
const HOTEL = TRIP.stays[0];
const NEAR_HOTEL = { lat: HOTEL.location.lat + 0.0003, lng: HOTEL.location.lng, accuracy: 9 };
const FAR_AWAY = { lat: 0, lng: 0, accuracy: 30 };

function renderDialog(memory = null) {
  const store = configureStore({
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
      timeline: { tripId: "trip-1", trip: TRIP, status: "idle", stale: false, savedAt: null },
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MemoryDialog open onClose={() => {}} tripId="trip-1" memory={memory} />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

async function writeAndSave(user, text) {
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("What happened?"), text);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  return apiClient.post.mock.calls.at(-1)[1];
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearOutbox(USER);
  apiClient.post.mockImplementation(async (url, body) => ({ data: { ...body, mine: true } }));
  apiClient.put.mockImplementation(async (url, body) => ({ data: { ...body, mine: true } }));
});

describe("a new memory's location", () => {
  it("already allowed: located as the dialog opens, named after the nearby trip place, and saved", async () => {
    const user = userEvent.setup();
    permissionState.mockResolvedValue("granted");
    currentPosition.mockResolvedValue(NEAR_HOTEL);
    renderDialog();
    expect(await screen.findByText(`Near ${HOTEL.name}`)).toBeInTheDocument();
    const body = await writeAndSave(user, "Breakfast on the terrace");
    expect(body.location).toEqual(NEAR_HOTEL);
  });

  it("not asked yet: the browser asks on Save, and the fix is saved", async () => {
    const user = userEvent.setup();
    permissionState.mockResolvedValue("prompt");
    currentPosition.mockResolvedValue(FAR_AWAY);
    renderDialog();
    expect(await screen.findByText("Location will be added")).toBeInTheDocument();
    expect(currentPosition).not.toHaveBeenCalled(); // no prompt just for opening
    const body = await writeAndSave(user, "Somewhere new");
    expect(currentPosition).toHaveBeenCalledTimes(1);
    expect(body.location).toEqual(FAR_AWAY);
  });

  it("denied or too slow: saves without one, never blocking", async () => {
    const user = userEvent.setup();
    permissionState.mockResolvedValue("prompt");
    currentPosition.mockResolvedValue(null); // denied, or timed out
    renderDialog();
    const body = await writeAndSave(user, "No GPS here");
    expect(body.location).toBeNull();
  });

  it("blocked in the browser: says so and saves without one", async () => {
    const user = userEvent.setup();
    permissionState.mockResolvedValue("denied");
    renderDialog();
    expect(await screen.findByText("Location unavailable")).toBeInTheDocument();
    const body = await writeAndSave(user, "x");
    expect(body.location).toBeNull();
    expect(currentPosition).not.toHaveBeenCalled();
  });

  it("can be left off one memory, and put back", async () => {
    const user = userEvent.setup();
    permissionState.mockResolvedValue("granted");
    currentPosition.mockResolvedValue(NEAR_HOTEL);
    renderDialog();
    await screen.findByText(`Near ${HOTEL.name}`);
    await user.click(screen.getByRole("button", { name: "Don’t add location" }));
    expect(screen.getByRole("button", { name: "Add location" })).toBeInTheDocument();
    const body = await writeAndSave(user, "Private moment");
    expect(body.location).toBeNull();
  });
});

describe("editing a memory's location", () => {
  const memory = {
    id: "m1",
    text: "Breakfast",
    zone: "Europe/Zurich",
    createdAt: "2026-05-11T07:00:00Z",
    location: NEAR_HOTEL,
    mine: true,
  };

  it("shows where it was written, and can remove it (never adds one)", async () => {
    const user = userEvent.setup();
    renderDialog(memory);
    expect(screen.getByText(`Near ${HOTEL.name}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove location" }));
    expect(screen.getByText("Location will be removed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
    expect(apiClient.put.mock.calls[0][1]).toEqual({ text: "Breakfast", isPublic: false, location: null });
    expect(permissionState).not.toHaveBeenCalled();
  });

  it("keeps it when untouched (the field isn't sent)", async () => {
    const user = userEvent.setup();
    renderDialog(memory);
    await user.type(screen.getByLabelText("What happened?"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
    expect(apiClient.put.mock.calls[0][1]).toEqual({ text: "Breakfast!", isPublic: false });
  });
});
