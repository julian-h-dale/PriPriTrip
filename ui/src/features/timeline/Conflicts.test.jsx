import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { tripRoutes } from "@/test/tripRoutes";
import { useTripRefresh } from "@/shared/pwa/useTripRefresh";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

/**
 * Two people editing one trip (api/app/services/versions.py): every change
 * sends the version it was made from; if someone else got there first, a
 * warning says who, the trip reloads, and the form closes. Nothing merges.
 */

const NOW = new Date("2026-05-11T12:00:00Z");

/** The sample trip as the API reads it back: ids and versions. */
function readTrip() {
  const trip = structuredClone(sampleTrip);
  trip.id = "trip-1";
  trip.stays.forEach((s, i) => Object.assign(s, { id: `stay-${i}`, version: 1 }));
  trip.travels.forEach((t, i) => Object.assign(t, { id: `travel-${i}`, version: 1 }));
  trip.days.forEach((day, d) => {
    Object.assign(day, { id: `day-${d}`, version: 1 });
    day.items.forEach((item, i) => Object.assign(item, { id: `item-${d}-${i}`, version: 1 }));
  });
  return trip;
}

let trip;

function App() {
  useTripRefresh();
  return <Routes>{tripRoutes()}</Routes>;
}

function renderDay(date) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      timeline: timelineReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[`/trips/trip-1/days/${date}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

const toasts = (store) => store.getState().notification.items.map((n) => [n.type, n.message]);

/** PriPri's version of the dinner, saved two minutes ago. */
function theirTrip() {
  const theirs = readTrip();
  Object.assign(theirs.days[0].items[2], {
    title: "Dinner at 8, not 7",
    version: 2,
    updatedByName: "PriPri",
    updatedAt: "2026-05-11T11:58:00Z",
  });
  return theirs;
}

async function openDinnerEdit(user) {
  await user.click(await screen.findByRole("link", { name: /Dinner at Kornhauskeller/ }));
  await user.click(await screen.findByRole("button", { name: "Edit activity" }));
  const dialog = screen.getByRole("dialog");
  const title = within(dialog).getByLabelText("Title");
  await user.clear(title);
  await user.type(title, "My dinner");
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  trip = readTrip();
  apiClient.get.mockResolvedValue({ data: trip });
});

afterEach(() => vi.useRealTimers());

describe("sending the version", () => {
  it("sends the version the entry was read at", async () => {
    const user = userEvent.setup();
    trip.days[0].items[2].version = 7;
    apiClient.put.mockResolvedValue({ data: trip });
    renderDay("2026-05-11");
    await openDinnerEdit(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(apiClient.put.mock.calls[0][2]).toEqual({
      silent: true,
      handles: [404, 409, 428],
      headers: { "If-Match": '"7"' },
    });
  });
});

describe("when someone else got there first", () => {
  it("a 409 closes the form, says who and when, and reloads the trip", async () => {
    const user = userEvent.setup();
    const store = renderDay("2026-05-11");
    const dialog = await openDinnerEdit(user);

    apiClient.put.mockRejectedValue({
      response: {
        status: 409,
        data: {
          detail: {
            message: "Someone else changed this while you were editing it.",
            version: 2,
            updatedByName: "PriPri",
            updatedAt: "2026-05-11T11:58:00Z",
            current: theirTrip().days[0].items[2],
          },
        },
      },
    });
    apiClient.get.mockResolvedValue({ data: theirTrip() });
    const loads = apiClient.get.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toasts(store)).toContainEqual(["warning", "PriPri changed this 2 minutes ago. Showing the latest."]);
    expect(apiClient.get.mock.calls.length).toBe(loads + 1);
    // Their change shows; mine is dropped.
    expect(await screen.findByText("Dinner at 8, not 7")).toBeInTheDocument();
    expect(screen.queryByText("My dinner")).not.toBeInTheDocument();
  });

  it("a 404 says it was removed, and reloads", async () => {
    const user = userEvent.setup();
    const store = renderDay("2026-05-11");
    await user.click(await screen.findByRole("link", { name: /Lunch at Altes Tramdepot/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    apiClient.delete.mockRejectedValue({ response: { status: 404, data: { detail: "Not found" } } });
    const gone = readTrip();
    gone.days[0].items.splice(0, 1);
    apiClient.get.mockResolvedValue({ data: gone });
    const confirm = screen.getByRole("dialog", { name: "Delete activity?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(toasts(store)).toContainEqual(["warning", "That was removed by someone else. Showing the latest."])
    );
    // Its page now says it's gone.
    expect(await screen.findByText("This isn’t on the trip any more")).toBeInTheDocument();
  });

  it("a 428 (an app too old to send a version) keeps the form open and says to reopen", async () => {
    const user = userEvent.setup();
    const store = renderDay("2026-05-11");
    const dialog = await openDinnerEdit(user);
    apiClient.put.mockRejectedValue({ response: { status: 428, data: { detail: "Needs If-Match" } } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(/Close and reopen it/)).toBeInTheDocument();
    expect(toasts(store)[0][0]).toBe("error");
  });
});

describe("who changed it", () => {
  it("an entry's details say who last edited it, and when", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: theirTrip() });
    renderDay("2026-05-11");
    await user.click(await screen.findByRole("link", { name: /Dinner at 8, not 7/ }));
    expect(await screen.findByText("Edited by PriPri, 2 minutes ago")).toBeInTheDocument();
    // Never-edited (imported) entries say nothing.
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(await screen.findByRole("link", { name: /Lunch at Altes Tramdepot/ }));
    await screen.findByRole("article", { name: "Lunch at Altes Tramdepot" });
    expect(screen.queryByText(/^Edited by/)).not.toBeInTheDocument();
  });
});

describe("coming back to the app", () => {
  it("reloads the open trip when the app returns to the foreground", async () => {
    renderDay("2026-05-11");
    await screen.findByRole("heading", { name: "Mon, May 11" });
    const loads = apiClient.get.mock.calls.length;
    apiClient.get.mockResolvedValue({ data: theirTrip() });

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    visibility.mockRestore();

    await waitFor(() => expect(apiClient.get.mock.calls.length).toBe(loads + 1));
    expect(apiClient.get).toHaveBeenLastCalledWith("/trips/trip-1", { silent: true, offlineOk: true });
    expect(await screen.findByText("Dinner at 8, not 7")).toBeInTheDocument();
  });
});
