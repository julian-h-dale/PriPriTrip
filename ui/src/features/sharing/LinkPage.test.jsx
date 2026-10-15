import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import notificationReducer from "@/shared/notificationSlice";
import { LinkPage } from "@/features/sharing/LinkPage";
import { apiClient } from "@/shared/services/apiClient";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const GUEST_TOKEN = fakeToken("guest-1");
const SESSION = { data: { access_token: GUEST_TOKEN, token_type: "bearer", trip_id: "t1" } };

function renderLink({ token = null, email = null } = {}) {
  const store = configureStore({
    reducer: { auth: authReducer, notification: notificationReducer },
    preloadedState: { auth: { token, user: email ? { email } : null, status: "idle" } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/s/the-secret"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/s/:secret" element={<LinkPage />} />
          <Route path="/trips/:tripId" element={<p>the trip</p>} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("opening a trip's secret link (Run stage 31)", () => {
  it("with no account: signed in as the link's guest, on the trip", async () => {
    apiClient.post.mockResolvedValue(SESSION);
    const store = renderLink();
    expect(await screen.findByText("the trip")).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith("/links/the-secret/session", null, { silent: true, handles: [404] });
    expect(store.getState().auth.token).toBe(GUEST_TOKEN);
    expect(localStorage.getItem("auth_token")).toBe(GUEST_TOKEN);
  });

  it("a link that's been rotated or turned off says so", async () => {
    apiClient.post.mockRejectedValue({ response: { status: 404 } });
    const store = renderLink();
    expect(await screen.findByRole("heading", { name: "This link doesn’t work any more" })).toBeInTheDocument();
    expect(screen.getByText("Ask whoever sent it for a new one.")).toBeInTheDocument();
    expect(store.getState().auth.token).toBeNull();
  });

  it("offline: try again", async () => {
    apiClient.post.mockRejectedValue(new Error("Network Error"));
    renderLink();
    expect(await screen.findByRole("heading", { name: "Couldn’t open the link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("signed in and already on the trip: just opens it, still yourself", async () => {
    const mine = fakeToken("julian");
    apiClient.post.mockResolvedValue(SESSION);
    apiClient.get.mockResolvedValue({ data: { id: "t1" } });
    const store = renderLink({ token: mine, email: "julian@example.com" });
    expect(await screen.findByText("the trip")).toBeInTheDocument();
    expect(store.getState().auth.token).toBe(mine);
  });

  it("signed in but not on the trip: asks before switching to the guest", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue(SESSION);
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    const store = renderLink({ token: fakeToken("julian"), email: "julian@example.com" });
    const dialog = await screen.findByRole("dialog", { name: "Open as a guest?" });
    expect(dialog).toHaveTextContent("You’ll be signed out of julian@example.com.");
    await user.click(screen.getByRole("button", { name: "Open as a guest" }));
    expect(await screen.findByText("the trip")).toBeInTheDocument();
    expect(store.getState().auth.token).toBe(GUEST_TOKEN);
  });

  it("…and Cancel keeps you as you are", async () => {
    const user = userEvent.setup();
    const mine = fakeToken("julian");
    apiClient.post.mockResolvedValue(SESSION);
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    const store = renderLink({ token: mine, email: "julian@example.com" });
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(store.getState().auth.token).toBe(mine);
  });
});
