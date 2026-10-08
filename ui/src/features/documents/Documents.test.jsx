import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import documentsReducer from "@/features/documents/documentsSlice";
import { extension, formatSize } from "@/features/documents/files";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { DocumentsPage } from "@/features/documents/DocumentsPage";
import { TopBar } from "@/shared/components/TopBar";
import { trackEvent } from "@/shared/analytics/umami";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { saveToPhone } from "@/features/journal/saveToPhone";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/shared/analytics/umami", () => ({ trackEvent: vi.fn(), trackPageView: vi.fn() }));
vi.mock("@/features/journal/saveToPhone", () => ({ saveToPhone: vi.fn(async () => "downloaded") }));

const trip = (role) => ({ id: "trip-1", name: "Okinawa & Taipei", role, days: [], stays: [], travels: [] });
const doc = (id, name, filename, contentType, size) => ({
  id,
  name,
  filename,
  contentType,
  size,
  updatedAt: "2026-10-06T14:00:00Z",
  uploadedByName: "Julian",
});
const DOCS = [
  doc("d1", "Ferry ticket", "ferry.pdf", "application/pdf", 1_300_000),
  doc("d2", "Passport", "passport.jpg", "image/jpeg", 350_000),
];

function store({ online = true } = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      documents: documentsReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: fakeToken("user-1"), user: { email: "u@x.com" }, status: "idle" }, network: { online } },
  });
}

function renderPage(options) {
  const s = store(options);
  render(
    <Provider store={s}>
      <MemoryRouter initialEntries={["/trips/trip-1/documents"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/documents" element={<DocumentsPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return s;
}

function serve(docs, role = "owner") {
  apiClient.get.mockImplementation(async (url, config) => {
    if (url.endsWith("/documents")) return { data: docs };
    if (config?.responseType === "blob") return { data: new Blob(["bytes"], { type: "application/zip" }) };
    return { data: trip(role) };
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAll();
});

describe("file helpers", () => {
  it("reads extensions and sizes", () => {
    expect(extension("Ticket.PDF")).toBe(".pdf");
    expect(extension("noext")).toBe("");
    expect(formatSize(1_300_000)).toBe("1.2 MB");
    expect(formatSize(350_000)).toBe("342 KB");
    expect(formatSize(10)).toBe("1 KB");
  });
});

describe("the Documents page", () => {
  it("offline: says documents need a connection", async () => {
    apiClient.get.mockImplementation(async (url) => {
      if (url.endsWith("/documents")) throw Object.assign(new Error("Network Error"), { config: {} });
      return { data: trip("owner") };
    });
    renderPage({ online: false });
    expect(await screen.findByText("You’re offline. Documents need a connection.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Couldn’t load the documents.")).not.toBeInTheDocument());
  });

  it("lists the documents with type, size and who added them", async () => {
    serve(DOCS);
    renderPage();
    const list = await screen.findByRole("list", { name: "Documents" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Ferry ticket");
    expect(rows[0]).toHaveTextContent(/PDF · 1\.2 MB · Julian/);
    expect(rows[1]).toHaveTextContent(/JPG · 342 KB/);
    expect(screen.getByRole("button", { name: "Download all (zip)" })).toBeEnabled();
  });

  it("shows an empty state, with Download all off", async () => {
    serve([]);
    renderPage();
    expect(await screen.findByText("No documents yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download all (zip)" })).toBeDisabled();
  });

  it("uploads a picked file", async () => {
    const user = userEvent.setup();
    serve([]);
    apiClient.post.mockResolvedValue({ data: doc("d3", "Hotel", "hotel.pdf", "application/pdf", 2048) });
    renderPage();
    await screen.findByText("No documents yet");
    const file = new File(["%PDF"], "hotel.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("document-file"), file);
    const [url, form] = apiClient.post.mock.calls[0];
    expect(url).toBe("/trips/trip-1/documents");
    expect(form.get("file")).toBe(file);
    expect(await screen.findByText("Hotel")).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith("document-upload", { url: "/trip/documents", role: "owner", replacing: false });
  });

  it("downloads everything as one zip named after the trip", async () => {
    const user = userEvent.setup();
    serve(DOCS);
    renderPage();
    await screen.findByText("Ferry ticket");
    await user.click(screen.getByRole("button", { name: "Download all (zip)" }));
    await waitFor(() => expect(saveToPhone).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledWith("/trips/trip-1/documents.zip", { responseType: "blob", silent: true });
    expect(saveToPhone.mock.calls[0][0].name).toBe("Okinawa & Taipei documents.zip");
    expect(trackEvent).toHaveBeenCalledWith("document-open", { url: "/trip/documents", role: "owner", all: true });
  });

  it("downloads one document by tapping it", async () => {
    const user = userEvent.setup();
    serve(DOCS);
    renderPage();
    await user.click(await screen.findByText("Passport"));
    await waitFor(() => expect(saveToPhone).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledWith("/trips/trip-1/documents/d2/file", { responseType: "blob", silent: true });
    expect(saveToPhone.mock.calls[0][0].name).toBe("Passport.jpg");
    expect(trackEvent).toHaveBeenCalledWith("document-open", { url: "/trip/documents", role: "owner" });
  });

  it("replaces, renames and deletes from ⋯", async () => {
    const user = userEvent.setup();
    serve(DOCS);
    apiClient.put.mockResolvedValue({ data: { ...DOCS[0], filename: "ferry-2.pdf", size: 4096 } });
    apiClient.patch.mockResolvedValue({ data: { ...DOCS[0], name: "Ferry to Zamami" } });
    apiClient.delete.mockResolvedValue({});
    renderPage();
    await screen.findByText("Ferry ticket");

    // Replace: each row has its own hidden picker.
    const file = new File(["%PDF2"], "ferry-2.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("document-file-d1"), file);
    const [putUrl, form] = apiClient.put.mock.calls[0];
    expect(putUrl).toBe("/trips/trip-1/documents/d1/file");
    expect(form.get("file")).toBe(file);
    expect(await screen.findByText(/PDF · 4 KB/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More for Ferry ticket" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const rename = screen.getByRole("dialog", { name: "Rename document" });
    await user.clear(within(rename).getByLabelText("Name"));
    await user.type(within(rename).getByLabelText("Name"), "Ferry to Zamami");
    await user.click(within(rename).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Ferry to Zamami")).toBeInTheDocument();
    expect(apiClient.patch).toHaveBeenCalledWith("/trips/trip-1/documents/d1", { name: "Ferry to Zamami" });

    await user.click(screen.getByRole("button", { name: "More for Passport" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete “Passport”?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Passport")).not.toBeInTheDocument());
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/trip-1/documents/d2");
  });

  it("offline, nothing can be done", async () => {
    serve(DOCS);
    renderPage({ online: false });
    await screen.findByText("Ferry ticket");
    expect(screen.getByRole("button", { name: "Download all (zip)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add a document" })).toBeDisabled();
  });
});

describe("Documents in the drawer", () => {
  async function drawerFor(role) {
    const s = store();
    s.dispatch({ type: "timeline/fetchTrip/pending", meta: { arg: "trip-1" } });
    s.dispatch({ type: "timeline/fetchTrip/fulfilled", payload: trip(role), meta: { arg: "trip-1" } });
    render(
      <Provider store={s}>
        <MemoryRouter initialEntries={["/trips/trip-1/today"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <TopBar title="x" />
        </MemoryRouter>
      </Provider>
    );
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    return within(screen.getByRole("navigation", { name: "Menu" })).queryByRole("region", { name: "Trip tools" });
  }

  it("is there for the owner and editors", async () => {
    const tools = await drawerFor("editor");
    expect(within(tools).getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/trips/trip-1/documents");
    expect(within(tools).getByRole("link", { name: "Packing" })).toBeInTheDocument();
  });

  it("isn't there for viewers: they get no Trip tools at all", async () => {
    expect(await drawerFor("viewer")).toBeNull();
  });
});
