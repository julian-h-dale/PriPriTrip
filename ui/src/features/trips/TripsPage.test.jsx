import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { TripsPage } from "@/features/trips/TripsPage";
import { apiClient } from "@/shared/services/apiClient";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const TRIP = {
  id: "t1",
  name: "Bern & Wengen Long Weekend",
  startDate: "2026-05-10",
  endDate: "2026-05-14",
  timezone: "Europe/Zurich",
  stayCount: 2,
  travelCount: 4,
  createdAt: "2026-10-02T05:24:40Z",
};

function renderPage() {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      trips: tripsReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: {
      auth: { token: "t", user: { email: "u@x.com", is_superuser: false }, status: "idle" },
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<TripsPage />} />
          <Route path="/trips/:tripId" element={<div>trip page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

function jsonFile() {
  return new File(['{"schemaVersion": 1}'], "trip.json", { type: "application/json" });
}

describe("TripsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists trips with dates and counts", async () => {
    apiClient.get.mockResolvedValue({ data: [TRIP] });
    renderPage();
    const link = await screen.findByRole("link", { name: /Bern & Wengen/ });
    expect(link).toHaveAttribute("href", "/trips/t1");
    expect(link).toHaveTextContent("May 10 – 14, 2026 · 4 nights");
    expect(link).toHaveTextContent("2 stays");
    expect(link).toHaveTextContent("4 legs");
  });

  it("shows an empty state with an import action", async () => {
    apiClient.get.mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText("No trips yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import trip/i })).toBeInTheDocument();
  });

  it("imports a file and opens the new trip", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [] });
    apiClient.post.mockResolvedValue({ data: { ...TRIP, id: "new-trip" } });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /import trip/i }));
    const dialog = screen.getByRole("dialog", { name: "Import trip" });
    const submit = within(dialog).getByRole("button", { name: "Import" });
    expect(submit).toBeDisabled();

    await user.upload(within(dialog).getByLabelText("Trip document"), jsonFile());
    await user.click(submit);

    expect(await screen.findByText("trip page")).toBeInTheDocument();
    const [url, body] = apiClient.post.mock.calls[0];
    expect(url).toBe("/trips/import");
    expect(body.get("file").name).toBe("trip.json");
  });

  it("lists every problem when the document is rejected", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [] });
    apiClient.post.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: "The trip document has 2 problems.",
          errors: [
            { path: "days[0].date", message: "2026-06-01 is outside the trip" },
            { path: "travels[1].arrive", message: "must be after depart" },
          ],
        },
      },
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /import trip/i }));
    const dialog = screen.getByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Trip document"), jsonFile());
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("The trip document has 2 problems.");
    expect(alert).toHaveTextContent("days[0].date");
    expect(alert).toHaveTextContent("must be after depart");
    expect(screen.queryByText("trip page")).not.toBeInTheDocument();
  });

  it("asks before deleting, and cancel keeps the trip", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [TRIP] });
    apiClient.delete.mockResolvedValue({});
    renderPage();

    await user.click(await screen.findByRole("button", { name: /delete bern/i }));
    let dialog = screen.getByRole("dialog", { name: "Delete trip?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(apiClient.delete).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Bern & Wengen/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete bern/i }));
    dialog = screen.getByRole("dialog", { name: "Delete trip?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(apiClient.delete).toHaveBeenCalledWith("/trips/t1", { silent: true });
    expect(await screen.findByText("No trips yet")).toBeInTheDocument();
  });
});
