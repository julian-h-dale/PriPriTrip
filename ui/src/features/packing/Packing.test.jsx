import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import packingReducer from "@/features/packing/packingSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { PackingPage } from "@/features/packing/PackingPage";
import { groupByCategory } from "@/features/packing/categories";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const TRIP = { id: "trip-1", name: "Okinawa & Taipei", role: "viewer", days: [], stays: [], travels: [] };
const item = (id, category, text, position, checked = false) => ({ id, category, text, position, checked });
const LIST = [
  item("a", "clothes", "Socks", 0),
  item("b", "clothes", "Swim shorts", 1, true),
  item("c", "electronics", "Plug adapter", 0),
];

function renderPage({ online = true } = {}) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      packing: packingReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" }, network: { online } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/trips/trip-1/packing"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/packing" element={<PackingPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

function serve(list) {
  apiClient.get.mockImplementation(async (url) => ({ data: url.endsWith("/packing") ? list : TRIP }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
});

describe("groupByCategory", () => {
  it("puts items in their lists, in position order", () => {
    const groups = groupByCategory([item("x", "clothes", "B", 1), item("y", "clothes", "A", 0)]);
    expect(groups.clothes.map((i) => i.text)).toEqual(["A", "B"]);
    expect(groups.toiletries).toEqual([]);
  });
});

describe("the Packing page", () => {
  it("shows each started list with its count, and the rest as lists to start", async () => {
    serve(LIST);
    renderPage();
    const clothes = await screen.findByRole("region", { name: "Clothes" });
    expect(within(clothes).getByText("1/2")).toBeInTheDocument();
    expect(within(clothes).getByRole("checkbox", { name: "Swim shorts" })).toBeChecked();
    expect(screen.getByRole("region", { name: "Electronics" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Toiletries" })).not.toBeInTheDocument();
    expect(screen.getByText(/of 3 packed/)).toHaveTextContent("1 of 3 packed");
    const more = screen.getByRole("region", { name: "More lists" });
    expect(within(more).getByRole("button", { name: "Toiletries" })).toBeInTheDocument();
  });

  it("ticks at once, and unticks again if the server refuses", async () => {
    const user = userEvent.setup();
    serve(LIST);
    let refuse;
    apiClient.patch.mockReturnValue(new Promise((_, reject) => (refuse = reject)));
    renderPage();
    const socks = await screen.findByRole("checkbox", { name: "Socks" });
    await user.click(socks);
    expect(socks).toBeChecked();
    expect(apiClient.patch).toHaveBeenCalledWith("/trips/trip-1/packing/a", { checked: true }, { silent: true });
    refuse(new Error("offline"));
    await waitFor(() => expect(socks).not.toBeChecked());
  });

  it("adds to a list", async () => {
    const user = userEvent.setup();
    serve(LIST);
    apiClient.post.mockResolvedValue({ data: item("d", "electronics", "Power bank", 1) });
    renderPage();
    const electronics = await screen.findByRole("region", { name: "Electronics" });
    await user.type(within(electronics).getByRole("textbox", { name: "Add to Electronics" }), "Power bank{Enter}");
    expect(apiClient.post).toHaveBeenCalledWith(
      "/trips/trip-1/packing",
      { category: "electronics", text: "Power bank" },
      { silent: true }
    );
    expect(await within(electronics).findByRole("checkbox", { name: "Power bank" })).toBeInTheDocument();
    expect(within(electronics).getByRole("textbox", { name: "Add to Electronics" })).toHaveValue("");
  });

  it("starts a new list from its button", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Toiletries" }));
    const toiletries = screen.getByRole("region", { name: "Toiletries" });
    expect(within(toiletries).getByRole("textbox", { name: "Add to Toiletries" })).toHaveFocus();
  });

  it("renames and deletes from ⋯", async () => {
    const user = userEvent.setup();
    serve(LIST);
    apiClient.patch.mockResolvedValue({ data: item("a", "clothes", "Wool socks", 0) });
    apiClient.delete.mockResolvedValue({});
    renderPage();
    await user.click(await screen.findByRole("button", { name: "More for Socks" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename" });
    const field = within(dialog).getByLabelText("What to pack");
    await user.clear(field);
    await user.type(field, "Wool socks");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("checkbox", { name: "Wool socks" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More for Plug adapter" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Plug adapter" })).not.toBeInTheDocument());
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/packing/c", { silent: true });
  });

  it("hides packed things on request", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    await screen.findByRole("checkbox", { name: "Swim shorts" });
    await user.click(screen.getByRole("button", { name: "Hide packed" }));
    expect(screen.queryByRole("checkbox", { name: "Swim shorts" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Socks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show packed" })).toHaveAttribute("aria-pressed", "true");
  });

  it("an empty list offers suggestions", async () => {
    const user = userEvent.setup();
    serve([]);
    apiClient.post.mockResolvedValue({ data: [item("p", "documents", "Passport", 0)] });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Start from suggestions" }));
    expect(apiClient.post).toHaveBeenCalledWith("/trips/trip-1/packing/suggestions", null, { silent: true });
    const documents = await screen.findByRole("region", { name: "Documents & money" });
    expect(within(documents).getByRole("checkbox", { name: "Passport" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start from suggestions" })).not.toBeInTheDocument();
  });

  it("offline, shows the list but can't change it", async () => {
    serve(LIST);
    renderPage({ online: false });
    expect(await screen.findByRole("checkbox", { name: "Socks" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("You’re offline");
  });
});
