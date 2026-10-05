import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import currencyReducer from "@/features/currency/currencySlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { CurrencyPage } from "@/features/currency/CurrencyPage";
import { apiClient } from "@/shared/services/apiClient";
import { clearAll } from "@/shared/services/tripCache";
import { fakeToken } from "@/test/fakeToken";
import { OKINAWA } from "@/features/currency/currency.test";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const RATES = [
  { date: "2026-10-05", base: "USD", quote: "JPY", rate: 157.93 },
  { date: "2026-10-05", base: "USD", quote: "TWD", rate: 31.821 },
];

function renderPage({ online = true } = {}) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      currency: currencyReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: fakeToken("user-1"), user: null, status: "idle" }, network: { online } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/trips/trip-1/currency"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/trips/:tripId/currency" element={<CurrencyPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

let fetchMock;
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await clearAll();
  apiClient.get.mockResolvedValue({ data: { ...OKINAWA, role: "viewer" } });
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("/currencies")
        ? [
            { iso_code: "EUR", name: "Euro", symbol: "€", end_date: new Date().toISOString().slice(0, 10) },
            { iso_code: "JPY", name: "Japanese Yen", symbol: "¥", end_date: new Date().toISOString().slice(0, 10) },
          ]
        : String(url).includes("EUR")
          ? [...RATES, { date: "2026-10-05", base: "USD", quote: "EUR", rate: 0.92 }]
          : RATES,
  }));
});
afterEach(() => vi.restoreAllMocks());

describe("the Currency page", () => {
  it("shows the trip's currencies, the rate, and converts to dollars", async () => {
    const user = userEvent.setup();
    renderPage();
    const chips = await screen.findByRole("group", { name: "Currencies" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["TWD", "JPY", "Other…"]);
    await user.click(within(chips).getByRole("button", { name: "JPY" }));
    const rate = await screen.findByRole("region", { name: "Rate" });
    expect(rate).toHaveTextContent("1 USD = 157.93 JPY");
    expect(rate).toHaveTextContent(/100 = \$0\.63/);

    await user.type(screen.getByLabelText("Amount in JPY"), "1000");
    expect(within(screen.getByRole("region", { name: "Calculator" })).getByText("$6.33")).toBeInTheDocument();

    // The other way round.
    await user.click(screen.getByRole("button", { name: "Swap: convert USD to JPY" }));
    expect(screen.getByLabelText("Amount in USD")).toHaveValue("6.33");
  });

  it("asks Frankfurter once, then uses the stored rate", async () => {
    renderPage();
    await screen.findByRole("region", { name: "Rate" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("quotes=TWD,JPY");
    // A second visit within 12 hours: no request.
    fetchMock.mockClear();
    document.body.innerHTML = "";
    renderPage();
    await screen.findByRole("region", { name: "Rate" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offline, uses the last rate it had, with its date", async () => {
    localStorage.setItem(
      "fx:USD",
      JSON.stringify({ fetchedAt: "2026-10-01T00:00:00Z", rates: { TWD: { rate: 32, date: "2026-10-01" }, JPY: { rate: 150, date: "2026-10-01" } } })
    );
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage({ online: false });
    const rate = await screen.findByRole("region", { name: "Rate" });
    expect(rate).toHaveTextContent("1 USD = 32 TWD");
    expect(screen.getByText(/Rate from 2026-10-01/)).toHaveTextContent("offline");
  });

  it("with no rate ever fetched and no connection, says to connect once", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage({ online: false });
    expect(await screen.findByText(/Connect once to get today’s rate/)).toBeInTheDocument();
  });

  it("adds another currency with Other…, remembered for the trip", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Other…" }));
    const dialog = screen.getByRole("dialog", { name: "Another currency" });
    const select = await within(dialog).findByLabelText("Currency");
    // The trip's own currencies aren't offered again.
    expect(within(select).queryByRole("option", { name: /JPY/ })).not.toBeInTheDocument();
    await user.selectOptions(select, "EUR");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("region", { name: "Rate" })).toHaveTextContent("1 USD = 0.92 EUR");
    expect(JSON.parse(localStorage.getItem("fx:trip:trip-1"))).toEqual(["EUR"]);
  });
});
