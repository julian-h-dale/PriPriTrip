import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { tripRoutes } from "@/test/tripRoutes";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

/** The sample trip in the API's read shape, with ids on days and activities. */
function readTrip() {
  const trip = structuredClone(sampleTrip);
  trip.id = "trip-1";
  // As the server reads it back: ids and versions.
  trip.days.forEach((day, d) => {
    Object.assign(day, { id: `day-${d}`, version: 1 });
    day.items.forEach((item, i) => Object.assign(item, { id: `item-${d}-${i}`, version: 1 }));
  });
  return trip;
}

let trip;

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
        <Routes>{tripRoutes()}</Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

/** Opens an entry's page from its row on the day. */
async function openEntry(user, name) {
  await user.click(await screen.findByRole("link", { name }));
  return screen.findByRole("article");
}

/** Entry texts on the rendered day. */
function entries() {
  return within(screen.getByRole("list", { name: /^Plans for/ }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  trip = readTrip();
  apiClient.get.mockResolvedValue({ data: trip });
});

describe("editing day activities", () => {
  it("every row opens its page; only activities get ⋯ to move them", async () => {
    renderDay("2026-05-11");
    const checkIn = await screen.findByRole("link", { name: /Check in · Hotel Goldener/ });
    expect(checkIn).toHaveAttribute("href", expect.stringMatching(/^\/trips\/trip-1\/stays\//));
    expect(within(checkIn.closest("li")).queryByRole("button")).not.toBeInTheDocument();

    const lunch = screen.getByRole("link", { name: /Lunch at Altes Tramdepot/ });
    expect(lunch).toHaveAttribute("href", "/trips/trip-1/activities/item-0-0");
    const user = userEvent.setup();
    await user.click(within(lunch.closest("li")).getByRole("button", { name: "More for Lunch at Altes Tramdepot" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeEnabled();
  });

  it("a bare activity opens its page too, where it can be edited", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-12");
    const page = await openEntry(user, /Stargazing from the balcony/);
    expect(page).toHaveAccessibleName("Stargazing from the balcony");
    expect(screen.getByRole("button", { name: "Edit activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("adds an activity to the selected day", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    updated.days[0].items.push({ id: "new", title: "Gelato", start: "2026-05-11T20:30" });
    apiClient.post.mockResolvedValue({ data: updated });
    renderDay("2026-05-11");

    await user.click(await screen.findByRole("button", { name: "Add activity to Mon, May 11" }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });
    await user.type(within(dialog).getByLabelText("Title"), "Gelato");
    fireEvent.change(within(dialog).getByLabelText("Start"), { target: { value: "20:30" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/items",
      { date: "2026-05-11", title: "Gelato", start: "2026-05-11T20:30" },
      { silent: true, handles: [404, 409, 428] }
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(entries().at(-1)).toContain("Gelato");
  });

  it("checks the title before calling the server", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    await user.click(await screen.findByRole("button", { name: "Add activity to Mon, May 11" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Give the activity a title")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("edits an activity, sending the whole activity back", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    updated.days[0].items[2].title = "Dinner at Kornhaus";
    apiClient.put.mockResolvedValue({ data: updated });
    renderDay("2026-05-11");

    await openEntry(user, /Dinner at Kornhauskeller/);
    await user.click(screen.getByRole("button", { name: "Edit activity" }));
    const title = within(screen.getByRole("dialog")).getByLabelText("Title");
    expect(title).toHaveValue("Dinner at Kornhauskeller");
    await user.clear(title);
    await user.type(title, "Dinner at Kornhaus");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const [url, body] = apiClient.put.mock.calls[0];
    expect(url).toBe("/trips/trip-1/items/item-0-2");
    expect(body).toEqual({
      date: "2026-05-11",
      title: "Dinner at Kornhaus",
      start: "2026-05-11T19:00",
      end: "2026-05-11T21:00",
      location: sampleTrip.days[0].items[2].location, // coordinates kept: same place
      confirmationNumber: "Table for 2, 19:00",
    });
    expect(await screen.findByRole("article", { name: "Dinner at Kornhaus" })).toBeInTheDocument();
  });

  it("shows server errors next to the field and keeps the form open", async () => {
    const user = userEvent.setup();
    apiClient.put.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: "The activity has 1 problem.",
          errors: [{ path: "location.url", message: "String should match pattern '^https?://'" }],
        },
      },
    });
    renderDay("2026-05-11");
    await openEntry(user, /Lunch at Altes Tramdepot/);
    await user.click(screen.getByRole("button", { name: "Edit activity" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Link"), "tramdepot.ch");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(/should match pattern/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Link")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog", { name: "Edit activity" })).toBeInTheDocument();
  });

  it("deletes an activity after confirming", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    updated.days[0].items.splice(0, 1);
    apiClient.delete.mockImplementation(async () => {
      apiClient.get.mockResolvedValue({ data: updated }); // the server has it gone now
      return { data: updated };
    });
    renderDay("2026-05-11");

    await openEntry(user, /Lunch at Altes Tramdepot/);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete activity?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/items/item-0-0", {
      silent: true,
      handles: [404, 409, 428],
      headers: { "If-Match": '"1"' },
    });
    // Back on its day, without it.
    expect(await screen.findByRole("heading", { name: "Mon, May 11" })).toBeInTheDocument();
    expect(screen.queryByText("Lunch at Altes Tramdepot")).not.toBeInTheDocument();
  });

  it("moves an untimed activity up", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    const [lunch, walk] = updated.days[0].items;
    updated.days[0].items.splice(0, 2, walk, lunch);
    apiClient.post.mockResolvedValue({ data: updated });
    renderDay("2026-05-11");

    await user.click(await screen.findByRole("button", { name: "More for Old Town & Zytglogge walk" }));
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));

    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/items/item-0-1/move",
      { direction: "up" },
      { silent: true, handles: [404, 409, 428] }
    );
    const order = entries();
    expect(order.findIndex((t) => t.includes("Old Town"))).toBeLessThan(
      order.findIndex((t) => t.includes("Lunch at Altes"))
    );
  });

  it("edits the day's title", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    updated.days.unshift({ id: "day-new", date: "2026-05-10", title: "Fly out", items: [] });
    apiClient.put.mockResolvedValue({ data: updated });
    renderDay("2026-05-10");

    await user.click(await screen.findByRole("button", { name: "Edit Sun, May 10 title and summary" }));
    await user.type(screen.getByLabelText("Title"), "Fly out");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The 10th has no day row yet: version 0.
    expect(apiClient.put).toHaveBeenCalledWith(
      "/trips/trip-1/days/2026-05-10",
      { title: "Fly out" },
      { silent: true, handles: [404, 409, 428], headers: { "If-Match": '"0"' } }
    );
    // The title leads the line under the date.
    expect(await screen.findByText("Fly out")).toHaveProperty("tagName", "STRONG");
  });

  it("marks an end time that falls on the next day", async () => {
    trip.days[0].items.push({
      id: "late",
      title: "Night walk",
      start: "2026-05-11T22:30",
      end: "2026-05-12T00:15",
    });
    renderDay("2026-05-11");
    const row = (await screen.findByText("Night walk")).closest("li");
    expect(row).toHaveTextContent("– 12:15 AM+1");
  });
});
