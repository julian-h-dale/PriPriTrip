import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
import { apiClient } from "@/shared/services/apiClient";
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

/** The sample trip in the API's read shape, with ids on days and activities. */
function readTrip() {
  const trip = structuredClone(sampleTrip);
  trip.id = "trip-1";
  trip.days.forEach((day, d) => {
    day.id = `day-${d}`;
    day.items.forEach((item, i) => (item.id = `item-${d}-${i}`));
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
        initialEntries={[`/trips/trip-1?day=${date}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/trips/:tripId" element={<TripTimelinePage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

/** Entry texts on one date's card. */
function entries(date = "2026-05-11") {
  const card = document.getElementById(`day-${date}`);
  return within(within(card).getByRole("list", { name: /^Plans for/ }))
    .getAllByRole("listitem", { name: "" })
    .filter((li) => li.parentElement.getAttribute("aria-label")?.startsWith("Plans for")).map((li) => li.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  trip = readTrip();
  apiClient.get.mockResolvedValue({ data: trip });
});

describe("editing day activities", () => {
  it("offers move only on activities; markers edit their booking", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    const checkIn = await screen.findByRole("button", { name: /Check in · Hotel Goldener/ });
    await user.click(checkIn);
    const row = checkIn.closest("li");
    const labels = within(row)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(labels).toContain("Edit stay Hotel Goldener Schlüssel");
    expect(labels).toContain("Delete stay Hotel Goldener Schlüssel");
    expect(labels.some((l) => /^Move/.test(l))).toBe(false);

    await user.click(screen.getByRole("button", { name: /Lunch at Altes Tramdepot/ }));
    expect(screen.getByRole("button", { name: "Edit Lunch at Altes Tramdepot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Lunch at Altes Tramdepot up" })).toBeDisabled();
  });

  it("makes a bare activity expandable so it can be edited", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-12");
    await user.click(await screen.findByRole("button", { name: /Stargazing from the balcony/ }));
    expect(screen.getByRole("button", { name: "Delete Stargazing from the balcony" })).toBeInTheDocument();
  });

  it("adds an activity to the selected day", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    updated.days[0].items.push({ id: "new", title: "Gelato", start: "2026-05-11T20:30" });
    apiClient.post.mockResolvedValue({ data: updated });
    renderDay("2026-05-11");

    await user.click(await screen.findByRole("button", { name: "Add to Mon, May 11" }));
    await user.click(screen.getByRole("button", { name: "Add activity on Mon, May 11" }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });
    await user.type(within(dialog).getByLabelText("Title"), "Gelato");
    fireEvent.change(within(dialog).getByLabelText("Start"), { target: { value: "20:30" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/items",
      { date: "2026-05-11", title: "Gelato", start: "2026-05-11T20:30" },
      { silent: true }
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(entries().at(-1)).toContain("Gelato");
  });

  it("checks the title before calling the server", async () => {
    const user = userEvent.setup();
    renderDay("2026-05-11");
    await user.click(await screen.findByRole("button", { name: "Add to Mon, May 11" }));
    await user.click(screen.getByRole("button", { name: "Add activity on Mon, May 11" }));
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

    await user.click(await screen.findByRole("button", { name: /Dinner at Kornhauskeller/ }));
    await user.click(screen.getByRole("button", { name: "Edit Dinner at Kornhauskeller" }));
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
    expect(await screen.findByText("Dinner at Kornhaus")).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: /Lunch at Altes Tramdepot/ }));
    await user.click(screen.getByRole("button", { name: "Edit Lunch at Altes Tramdepot" }));
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
    apiClient.delete.mockResolvedValue({ data: updated });
    renderDay("2026-05-11");

    await user.click(await screen.findByRole("button", { name: /Lunch at Altes Tramdepot/ }));
    await user.click(screen.getByRole("button", { name: "Delete Lunch at Altes Tramdepot" }));
    const confirm = screen.getByRole("dialog", { name: "Delete activity?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/items/item-0-0", { silent: true });
    expect(screen.queryByText("Lunch at Altes Tramdepot")).not.toBeInTheDocument();
  });

  it("moves an untimed activity up", async () => {
    const user = userEvent.setup();
    const updated = readTrip();
    const [lunch, walk] = updated.days[0].items;
    updated.days[0].items.splice(0, 2, walk, lunch);
    apiClient.post.mockResolvedValue({ data: updated });
    renderDay("2026-05-11");

    await user.click(await screen.findByRole("button", { name: /Old Town & Zytglogge walk/ }));
    await user.click(screen.getByRole("button", { name: "Move Old Town & Zytglogge walk up" }));

    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/items/item-0-1/move",
      { direction: "up" },
      { silent: true }
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

    expect(apiClient.put).toHaveBeenCalledWith(
      "/trips/trip-1/days/2026-05-10",
      { title: "Fly out" },
      { silent: true }
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
