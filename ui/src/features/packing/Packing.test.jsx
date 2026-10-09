import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import packingReducer, { addPackingItem, fetchPacking, syncPacking } from "@/features/packing/packingSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { PackingPage } from "@/features/packing/PackingPage";
import { groupByCategory } from "@/features/packing/categories";
import { trackEvent } from "@/shared/analytics/umami";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll, savePacking } from "@/shared/services/tripCache";
import { clearPackingQueue, waitingChanges } from "@/shared/services/packingQueue";
import { setOnline } from "@/shared/networkSlice";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/shared/analytics/umami", () => ({ trackEvent: vi.fn(), trackPageView: vi.fn() }));

const TRIP = { id: "trip-1", name: "Okinawa & Taipei", role: "editor", days: [], stays: [], travels: [] };
const item = (id, category, text, position, checked = false, quantity = 1) => ({ id, category, text, position, checked, quantity });
const LIST = [
  item("a", "clothes", "Socks", 0, false, 7),
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

/**
 * A small stand-in for the server's packing list: GET, add (with the
 * phone's id), PATCH, DELETE a line or a list. A change ends with a reload
 * of the list, so the stand-in has to remember what it was sent.
 */
let server = [];
function serve(list) {
  server = list.map((i) => ({ ...i }));
  apiClient.get.mockImplementation(async (url) => ({ data: url.endsWith("/packing") ? server.map((i) => ({ ...i })) : TRIP }));
  apiClient.post.mockImplementation(async (url, body) => {
    const position = server.filter((i) => i.category === body.category).length;
    const added = { checked: false, quantity: 1, position, ...body };
    server.push(added);
    return { data: { ...added } };
  });
  apiClient.patch.mockImplementation(async (url, body) => {
    const line = server.find((i) => i.id === url.split("/").pop());
    if (!line) throw { response: { status: 404 } };
    Object.assign(line, body);
    return { data: { ...line } };
  });
  apiClient.delete.mockImplementation(async (url) => {
    const last = url.split("/").pop();
    server = url.includes("/lists/") ? server.filter((i) => i.category !== last) : server.filter((i) => i.id !== last);
    return {};
  });
}
const SILENT = expect.objectContaining({ silent: true });

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
  await clearPackingQueue("user-1");
});

describe("groupByCategory", () => {
  it("puts items in their lists, in position order", () => {
    const groups = groupByCategory([item("x", "clothes", "B", 1), item("y", "clothes", "A", 0)]);
    expect(groups.clothes.map((i) => i.text)).toEqual(["A", "B"]);
    expect(groups.toiletries).toEqual([]);
  });
});

describe("the Packing page", () => {
  it("offline: says the list needs a connection (it isn't saved on the phone)", async () => {
    apiClient.get.mockImplementation(async (url) => {
      if (url.endsWith("/packing")) throw Object.assign(new Error("Network Error"), { config: {} });
      return { data: TRIP };
    });
    renderPage({ online: false });
    expect(await screen.findByText(/Your packing list needs a connection/)).toBeInTheDocument();
  });

  it("shows each started list with its count, and the rest as lists to start", async () => {
    serve(LIST);
    renderPage();
    const clothes = await screen.findByRole("region", { name: "Clothes" });
    expect(within(clothes).getByText("1/2")).toBeInTheDocument();
    expect(within(clothes).getByRole("checkbox", { name: "Swim shorts" })).toBeChecked();
    // A quantity shows when it's more than one.
    expect(within(clothes).getByRole("checkbox", { name: "Socks ×7" })).not.toBeChecked();
    expect(screen.getByRole("region", { name: "Electronics" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Toiletries" })).not.toBeInTheDocument();
    expect(screen.getByText(/of 3 packed/)).toHaveTextContent("1 of 3 packed");
    const more = screen.getByRole("region", { name: "More lists" });
    expect(within(more).getByRole("button", { name: "Toiletries" })).toBeInTheDocument();
  });

  it("ticks at once, and unticks again if the server refuses it for good", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    const socks = await screen.findByRole("checkbox", { name: "Socks ×7" });
    let refuse;
    apiClient.patch.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    await user.click(socks);
    expect(socks).toBeChecked();
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/trips/trip-1/packing/a", { checked: true }, SILENT));
    expect(trackEvent).toHaveBeenCalledWith("packing-check", { url: "/trip/packing", role: "editor" });
    refuse({ response: { status: 404 } }); // gone on the server: the list is reloaded
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Socks ×7" })).not.toBeChecked());
  });

  it("adds to a list, with how many", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    const electronics = await screen.findByRole("region", { name: "Electronics" });
    const howMany = within(electronics).getByRole("spinbutton", { name: "How many, for Electronics" });
    expect(howMany).toHaveValue(1);
    await user.clear(howMany);
    await user.type(howMany, "3");
    await user.type(within(electronics).getByRole("textbox", { name: "Add to Electronics" }), "Cables{Enter}");
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/trips/trip-1/packing",
        { id: expect.any(String), category: "electronics", text: "Cables", quantity: 3 },
        SILENT
      )
    );
    expect(await within(electronics).findByRole("checkbox", { name: "Cables ×3" })).toBeInTheDocument();
    expect(within(electronics).getByRole("textbox", { name: "Add to Electronics" })).toHaveValue("");
    expect(howMany).toHaveValue(1);
    expect(trackEvent).toHaveBeenCalledWith("packing-add", { url: "/trip/packing", role: "editor", from: "typed" });
  });

  it("starts a new list from its button", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Toiletries" }));
    const toiletries = screen.getByRole("region", { name: "Toiletries" });
    expect(within(toiletries).getByRole("textbox", { name: "Add to Toiletries" })).toHaveFocus();
  });

  it("edits (name and how many) and deletes from ⋯", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "More for Socks" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit" });
    const field = within(dialog).getByLabelText("What to pack");
    expect(within(dialog).getByLabelText("How many")).toHaveValue(7);
    await user.clear(field);
    await user.type(field, "Wool socks");
    await user.clear(within(dialog).getByLabelText("How many"));
    await user.type(within(dialog).getByLabelText("How many"), "4");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith("/trips/trip-1/packing/a", { text: "Wool socks", quantity: 4 }, SILENT)
    );
    expect(await screen.findByRole("checkbox", { name: "Wool socks ×4" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More for Plug adapter" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Plug adapter" })).not.toBeInTheDocument());
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/packing/c", SILENT));
  });

  it("deletes a whole list after asking; it can be started again", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "More for the Clothes list" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete list" }));
    const confirm = screen.getByRole("dialog", { name: "Delete the Clothes list?" });
    expect(confirm).toHaveTextContent("Its 2 things go too");
    await user.click(within(confirm).getByRole("button", { name: "Delete list" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/packing/lists/clothes", SILENT));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Clothes" })).not.toBeInTheDocument());
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "More lists" })).getByRole("button", { name: "Clothes" })).toBeInTheDocument()
    );
  });

  it("an empty list just closes", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Toiletries" }));
    await user.click(screen.getByRole("button", { name: "More for the Toiletries list" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete list" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Toiletries" })).not.toBeInTheDocument();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it("hides packed things on request", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    await screen.findByRole("checkbox", { name: "Swim shorts" });
    await user.click(screen.getByRole("button", { name: "Hide packed" }));
    expect(screen.queryByRole("checkbox", { name: "Swim shorts" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Socks ×7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show packed" })).toHaveAttribute("aria-pressed", "true");
  });

  it("an empty list offers suggestions", async () => {
    const user = userEvent.setup();
    serve([]);
    apiClient.post.mockResolvedValue({ data: [item("p", "documents", "Passport", 0)] });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Start from suggestions" }));
    expect(apiClient.post).toHaveBeenCalledWith("/trips/trip-1/packing/suggestions", null, SILENT);
    const documents = await screen.findByRole("region", { name: "Documents & money" });
    expect(within(documents).getByRole("checkbox", { name: "Passport" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start from suggestions" })).not.toBeInTheDocument();
  });

  it("offline: the saved list shows, changes show at once and wait, and go once back online", async () => {
    const user = userEvent.setup();
    serve(LIST);
    await savePacking("user-1", "trip-1", LIST);
    apiClient.get.mockRejectedValue(Object.assign(new Error("Network Error"), { config: {} }));
    const store = renderPage({ online: false });
    const socks = await screen.findByRole("checkbox", { name: "Socks ×7" });
    expect(socks).toBeEnabled();

    await user.click(socks); // tick
    const electronics = screen.getByRole("region", { name: "Electronics" });
    await user.type(within(electronics).getByRole("textbox", { name: "Add to Electronics" }), "Charger{Enter}");
    await user.click(screen.getByRole("button", { name: "More for Plug adapter" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(socks).toBeChecked();
    expect(await within(electronics).findByRole("checkbox", { name: "Charger" })).toBeInTheDocument();
    expect(within(electronics).queryByRole("checkbox", { name: "Plug adapter" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("You’re offline. Your changes are saved on this phone (3 waiting)")
    );
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.delete).not.toHaveBeenCalled();
    expect((await waitingChanges("user-1", "trip-1")).map((c) => c.op)).toEqual(["update", "create", "delete"]);

    // Back online: sent once, in order, then the list reloads from the server.
    serve(LIST);
    store.dispatch(setOnline(true));
    await store.dispatch(syncPacking());
    expect(apiClient.patch).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.delete).toHaveBeenCalledTimes(1);
    expect(await waitingChanges("user-1", "trip-1")).toEqual([]);
    expect(server.map((i) => [i.text, i.checked])).toEqual([
      ["Socks", true],
      ["Swim shorts", true],
      ["Charger", false],
    ]);
  });

  it("a tick then an untick of the same thing sends only the last state", async () => {
    const user = userEvent.setup();
    serve(LIST);
    await savePacking("user-1", "trip-1", LIST);
    apiClient.get.mockRejectedValue(Object.assign(new Error("Network Error"), { config: {} }));
    const store = renderPage({ online: false });
    const socks = await screen.findByRole("checkbox", { name: "Socks ×7" });
    await user.click(socks);
    await user.click(socks);
    serve(LIST);
    store.dispatch(setOnline(true));
    await store.dispatch(syncPacking());
    expect(apiClient.patch.mock.calls).toEqual([["/trips/trip-1/packing/a", { checked: false }, SILENT]]);
  });

  it("a load that finishes after a newer one doesn't put back its older list", async () => {
    // CI caught this as a flaky "adds to a list": the page's first load
    // landed after the one made once the add was sent, and the new line
    // vanished from the screen.
    const store = configureStore({
      reducer: { auth: authReducer, packing: packingReducer, network: networkReducer },
      preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" }, network: { online: true } },
    });
    let answerFirst;
    apiClient.get.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    const first = store.dispatch(fetchPacking("trip-1"));
    const added = [...LIST, item("d", "electronics", "Cables", 1, false, 3)];
    apiClient.get.mockResolvedValueOnce({ data: added });
    await store.dispatch(fetchPacking("trip-1"));
    expect(store.getState().packing.items.map((i) => i.text)).toContain("Cables");
    answerFirst({ data: LIST }); // the older answer, arriving last
    await first;
    expect(store.getState().packing.items.map((i) => i.text)).toContain("Cables");
  });

  it("reloading a list on screen doesn't flash the older saved copy", async () => {
    // CI's flaky "adds to a list": after the add was sent, the reload showed
    // the phone's saved copy (from before the add, which had left the queue)
    // until the server answered, and the new line vanished meanwhile.
    const store = configureStore({
      reducer: { auth: authReducer, packing: packingReducer, network: networkReducer },
      preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" }, network: { online: true } },
    });
    apiClient.get.mockResolvedValueOnce({ data: LIST });
    await store.dispatch(fetchPacking("trip-1")); // saves LIST on the phone
    // Add a line: on screen at once, then sent, then the list reloads.
    apiClient.post.mockResolvedValue({ data: {} });
    let answer;
    apiClient.get.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await store.dispatch(addPackingItem({ tripId: "trip-1", category: "electronics", text: "Cables", quantity: 3 }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2)); // the reload, past its saved-copy step
    expect(store.getState().packing.items.map((i) => i.text)).toContain("Cables");
    answer({ data: [...LIST, item("d", "electronics", "Cables", 1, false, 3)] });
    await waitFor(() => expect(store.getState().packing.items.find((i) => i.text === "Cables")?.waiting).toBeFalsy());
  });

  it("suggestions need a connection", async () => {
    serve([]);
    await savePacking("user-1", "trip-1", []);
    apiClient.get.mockRejectedValue(Object.assign(new Error("Network Error"), { config: {} }));
    renderPage({ online: false });
    expect(await screen.findByRole("button", { name: "Start from suggestions" })).toBeDisabled();
    expect(screen.getByText("Suggestions need a connection.")).toBeInTheDocument();
  });
});

describe("Packing's analytics", () => {
  it("counts ticking something, not unticking it", async () => {
    const user = userEvent.setup();
    serve(LIST);
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "Swim shorts" })); // already packed
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
