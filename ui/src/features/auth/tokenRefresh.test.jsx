import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import authReducer, { clearAuth, tokenNeedsRefresh } from "@/features/auth/authSlice";
import networkReducer from "@/shared/networkSlice";
import { apiClient } from "@/shared/services/apiClient";
import { useTokenRefresh } from "@/shared/pwa/useTokenRefresh";
import { tokenExpiry } from "@/shared/utils/authToken";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const aged = (days, user = "u1") => fakeToken(user, { exp: NOW + (60 - days) * DAY });

function Probe() {
  useTokenRefresh();
  return null;
}

function setup(token, { online = true } = {}) {
  localStorage.setItem("auth_token", token);
  const store = configureStore({
    reducer: { auth: authReducer, network: networkReducer },
    preloadedState: { auth: { token, user: null, status: "idle" }, network: { online } },
  });
  render(
    <Provider store={store}>
      <Probe />
    </Provider>
  );
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("tokenNeedsRefresh", () => {
  it("is true only for an unexpired token over a day old", () => {
    expect(tokenNeedsRefresh(aged(0), NOW)).toBe(false); // just issued
    expect(tokenNeedsRefresh(aged(0.5), NOW)).toBe(false);
    expect(tokenNeedsRefresh(aged(2), NOW)).toBe(true);
    expect(tokenNeedsRefresh(aged(59.9), NOW)).toBe(true);
    expect(tokenNeedsRefresh(aged(61), NOW)).toBe(false); // expired: sign in again
    expect(tokenNeedsRefresh(fakeToken("u1"), NOW)).toBe(false); // no exp
    expect(tokenNeedsRefresh(null, NOW)).toBe(false);
  });
});

describe("the quiet token refresh", () => {
  it("swaps a token over a day old on start, and stores it", async () => {
    const fresh = aged(0);
    apiClient.post.mockResolvedValue({ data: { access_token: fresh, token_type: "bearer" } });
    const store = setup(aged(5));
    await waitFor(() => expect(store.getState().auth.token).toBe(fresh));
    expect(apiClient.post).toHaveBeenCalledWith("/auth/refresh", null, expect.objectContaining({ background: true }));
    expect(localStorage.getItem("auth_token")).toBe(fresh);
    expect(tokenExpiry(fresh)).toBeGreaterThan(NOW + 59 * DAY);
  });

  it("leaves a fresh token alone", async () => {
    setup(aged(0.2));
    await act(async () => {});
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("does nothing offline", async () => {
    setup(aged(5), { online: false });
    await act(async () => {});
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("keeps the old token when the refresh fails", async () => {
    const old = aged(5);
    apiClient.post.mockRejectedValue(new Error("Network Error"));
    const store = setup(old);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    await act(async () => {});
    expect(store.getState().auth.token).toBe(old);
    expect(localStorage.getItem("auth_token")).toBe(old);
  });

  it("runs again when the app returns to the foreground", async () => {
    apiClient.post.mockRejectedValue(new Error("Network Error"));
    setup(aged(5));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
  });

  it("a refresh landing after sign-out doesn't sign back in", async () => {
    let answer;
    apiClient.post.mockReturnValue(new Promise((r) => (answer = r)));
    const store = setup(aged(5));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    act(() => store.dispatch(clearAuth()));
    await act(async () => answer({ data: { access_token: aged(0), token_type: "bearer" } }));
    expect(store.getState().auth.token).toBeNull();
    expect(localStorage.getItem("auth_token")).toBeNull();
  });
});
