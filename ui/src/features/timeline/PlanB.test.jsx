import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { entrySequence, findEntry, neighbours } from "@/features/entry/entries";
import { buildMapMarkers } from "@/features/map/buildMapMarkers";
import { searchTrip } from "@/features/search/tripSearch";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { setShowsPlanB, showsPlanB } from "@/features/timeline/planChoice";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import { TRIP } from "@/test/sampleTrip";
import { tripRoutes } from "@/test/tripRoutes";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

// The sample's Männlichen day has a plan B (rain): Trümmelbach Falls.
const RAINY = "2026-05-13";
const RAINY_HEADING = "Wed, May 13";

function rainyRow(trip, options) {
  return buildTimeline(trip, options).find((r) => r.date === RAINY);
}

function titlesOf(row) {
  return row.entries.map((e) => e.item?.title ?? e.phase);
}

function withoutPlanB(trip) {
  const t = structuredClone(trip);
  t.days.forEach((d) => (d.planB = []));
  return t;
}

function renderAt(path, { trip = TRIP } = {}) {
  apiClient.get.mockResolvedValue({ data: trip });
  const store = configureStore({
    reducer: { auth: authReducer, journal: journalReducer, timeline: timelineReducer, network: networkReducer, error: errorReducer, notification: notificationReducer },
    preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" }, network: { online: true } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>{tripRoutes()}</Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

function dayList() {
  return screen.getByRole("list", { name: new RegExp(`(Plans|Plan B) for ${RAINY_HEADING}`) });
}

function dayTexts() {
  return within(dayList()).getAllByRole("listitem").map((li) => li.textContent);
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await clearAll();
});

describe("buildTimeline with plan B", () => {
  it("without the option, every day shows its plan (Today, search, the trip timeline)", () => {
    const row = rainyRow(TRIP);
    expect(row.hasPlanB).toBe(true);
    expect(row.showingPlanB).toBe(false);
    expect(titlesOf(row)).toEqual(["staying", "Männlichen → Kleine Scheidegg hike", "Lunch at Kleine Scheidegg", "Fondue night"]);
  });

  it("showing plan B swaps the activities and keeps the booking rows", () => {
    const row = rainyRow(TRIP, { planB: (d) => d === RAINY });
    expect(row.showingPlanB).toBe(true);
    expect(titlesOf(row)).toEqual(["staying", "Trümmelbach Falls", "Lunch in Lauterbrunnen", "Fondue night"]);
    // Index and count are within plan B, for its ⋯ Move up / down.
    expect(row.entries[1]).toMatchObject({ index: 0, count: 3 });
  });

  it("a day with no plan B shows its plan whatever the option says", () => {
    const row = buildTimeline(TRIP, { planB: () => true }).find((r) => r.date === "2026-05-12");
    expect(row.hasPlanB).toBe(false);
    expect(row.showingPlanB).toBe(false);
    expect(row.entries.some((e) => e.item?.title === "Morning at the Rose Garden")).toBe(true);
    // Booking rows are the same either way: the train to Wengen.
    const travel = (r) => r.entries.filter((e) => e.kind !== "activity").map((e) => e.key);
    expect(travel(row)).toEqual(travel(buildTimeline(TRIP).find((r) => r.date === "2026-05-12")));
  });
});

describe("plan B stays off everything but the day page", () => {
  it("has no map pin", () => {
    const titles = buildMapMarkers(TRIP).map((m) => m.title);
    expect(titles).toContain("Männlichen → Kleine Scheidegg hike");
    expect(titles).not.toContain("Trümmelbach Falls");
  });

  it("isn't found by search", () => {
    expect(searchTrip(TRIP, "Trümmelbach")).toEqual([]);
    expect(searchTrip(TRIP, "Männlichen").length).toBeGreaterThan(0);
  });
});

describe("the plan choice (this phone only)", () => {
  it("is remembered per trip and day until switched back", () => {
    expect(showsPlanB("trip-1", RAINY)).toBe(false);
    setShowsPlanB("trip-1", RAINY, true);
    expect(showsPlanB("trip-1", RAINY)).toBe(true);
    expect(showsPlanB("trip-2", RAINY)).toBe(false);
    expect(showsPlanB("trip-1", "2026-05-12")).toBe(false);
    setShowsPlanB("trip-1", RAINY, false);
    expect(showsPlanB("trip-1", RAINY)).toBe(false);
    expect(localStorage.getItem("planB")).toBeNull();
  });
});

describe("entries and plan B", () => {
  it("finds a plan B activity, marked as plan B", () => {
    expect(findEntry(TRIP, "activity", `${RAINY}-b-0`)).toMatchObject({ date: RAINY, planB: true, record: { title: "Trümmelbach Falls" } });
    expect(findEntry(TRIP, "activity", `${RAINY}-0`).planB).toBeUndefined();
  });

  it("moving through a plan B day stays within plan B", () => {
    const steps = entrySequence(TRIP, { planB: (d) => d === RAINY });
    const { prev, next } = neighbours(steps, "activity", `${RAINY}-b-1`);
    expect(prev.id).toBe(`${RAINY}-b-0`);
    expect(next.id).toBe(`${RAINY}-b-2`);
    expect(steps.some((s) => s.id === `${RAINY}-0`)).toBe(false);
  });
});

describe("the day page", () => {
  it("has no plan B button on a day without plan B", async () => {
    renderAt("/trips/trip-1/days/2026-05-12");
    await screen.findByRole("heading", { name: "Tue, May 12" });
    expect(screen.queryByRole("button", { name: "Plan B" })).not.toBeInTheDocument();
  });

  it("starts on plan A; the plan B button shows plan B and keeps the booking rows; and back", async () => {
    const user = userEvent.setup();
    renderAt(`/trips/trip-1/days/${RAINY}`);
    const button = await screen.findByRole("button", { name: "Plan B" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    const header = screen.getByRole("heading", { name: RAINY_HEADING }).closest("header");
    expect(within(header).queryByText("Plan B")).not.toBeInTheDocument();
    expect(dayTexts().join(" ")).toContain("Männlichen → Kleine Scheidegg hike");
    expect(dayTexts().join(" ")).not.toContain("Trümmelbach");

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(within(header).getByText("Plan B")).toBeInTheDocument(); // the tag beside the date
    expect(screen.getByRole("list", { name: `Plan B for ${RAINY_HEADING}` })).toBeInTheDocument();
    const texts = dayTexts().join(" ");
    expect(texts).toContain("Trümmelbach Falls");
    expect(texts).not.toContain("Männlichen → Kleine Scheidegg hike");
    expect(texts).toContain("Beausite Park Hotel"); // staying there: under both plans
    expect(showsPlanB("trip-1", RAINY)).toBe(true);

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(dayTexts().join(" ")).toContain("Männlichen → Kleine Scheidegg hike");
    expect(showsPlanB("trip-1", RAINY)).toBe(false);
  });

  it("stays on plan B after opening an activity and coming back", async () => {
    const user = userEvent.setup();
    setShowsPlanB("trip-1", RAINY, true);
    renderAt(`/trips/trip-1/days/${RAINY}`);
    await user.click(await screen.findByRole("link", { name: /Trümmelbach Falls/ }));
    const article = await screen.findByRole("article");
    expect(within(article).getByText("Plan B")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("list", { name: `Plan B for ${RAINY_HEADING}` })).toBeInTheDocument();
  });

  it("a viewer sees no plan B button", async () => {
    // The server never sends a viewer plan B; even a stored choice shows plan A.
    setShowsPlanB("trip-1", RAINY, true);
    renderAt(`/trips/trip-1/days/${RAINY}`, { trip: { ...withoutPlanB(TRIP), role: "viewer" } });
    await screen.findByRole("heading", { name: RAINY_HEADING });
    expect(screen.queryByRole("button", { name: "Plan B" })).not.toBeInTheDocument();
    expect(dayTexts().join(" ")).toContain("Männlichen → Kleine Scheidegg hike");
  });

  it("Add activity under plan B starts in plan B and sends planB: true", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: TRIP });
    setShowsPlanB("trip-1", RAINY, true);
    renderAt(`/trips/trip-1/days/${RAINY}`);
    await user.click(await screen.findByRole("button", { name: `Add activity to plan B for ${RAINY_HEADING}` }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });
    expect(within(dialog).getByRole("switch", { name: "Plan B" })).toHaveAttribute("aria-checked", "true");
    await user.type(within(dialog).getByLabelText("Title"), "Chocolate shop");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/items",
      { date: RAINY, title: "Chocolate shop", planB: true },
      expect.anything()
    );
  });

  it("Add activity under plan A leaves it out of the payload, unless switched on", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: TRIP });
    renderAt(`/trips/trip-1/days/${RAINY}`);
    await user.click(await screen.findByRole("button", { name: `Add activity to ${RAINY_HEADING}` }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });
    const toggle = within(dialog).getByRole("switch", { name: "Plan B" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.type(within(dialog).getByLabelText("Title"), "Nap");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(apiClient.post.mock.calls[0][1]).toEqual({ date: RAINY, title: "Nap" });
  });

  it("editing a plan B activity can move it to plan A", async () => {
    const user = userEvent.setup();
    apiClient.put.mockResolvedValue({ data: TRIP });
    renderAt(`/trips/trip-1/activities/${RAINY}-b-0`);
    await user.click(await screen.findByRole("button", { name: "Edit activity" }));
    const dialog = screen.getByRole("dialog", { name: "Edit activity" });
    const toggle = within(dialog).getByRole("switch", { name: "Plan B" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const [url, body] = apiClient.put.mock.calls[0];
    expect(url).toBe(`/trips/trip-1/items/${RAINY}-b-0`);
    expect(body.planB).toBeUndefined();
    expect(body.title).toBe("Trümmelbach Falls");
  });

  it("deleting the last plan B activity drops the button and shows plan A", async () => {
    const user = userEvent.setup();
    const one = structuredClone(TRIP);
    const rainy = one.days.find((d) => d.date === RAINY);
    rainy.planB = rainy.planB.slice(0, 1);
    apiClient.delete.mockResolvedValue({ data: withoutPlanB(one) });
    setShowsPlanB("trip-1", RAINY, true);
    renderAt(`/trips/trip-1/activities/${RAINY}-b-0`, { trip: one });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    apiClient.get.mockResolvedValue({ data: withoutPlanB(one) });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await screen.findByRole("heading", { name: RAINY_HEADING });
    expect(screen.queryByRole("button", { name: "Plan B" })).not.toBeInTheDocument();
    expect(dayTexts().join(" ")).toContain("Männlichen → Kleine Scheidegg hike");
    expect(showsPlanB("trip-1", RAINY)).toBe(false);
  });
});
