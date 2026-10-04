import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient, injectStore } from "@/shared/services/apiClient";

// The response interceptor's error handler, called directly.
const onError = (error) => apiClient.interceptors.response.handlers[0].rejected(error).catch(() => {});

describe("apiClient offline handling", () => {
  const store = { dispatch: vi.fn(), getState: () => ({ auth: { token: null } }) };
  beforeEach(() => {
    store.dispatch.mockClear();
    injectStore(store);
  });

  it("stays quiet for an offline-tolerant request that got no response", async () => {
    await onError({ config: { offlineOk: true }, message: "Network Error" });
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it("still reports a network error on an ordinary request", async () => {
    await onError({ config: {}, message: "Network Error" });
    expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "error/setError" }));
  });

  it("stays quiet when background housekeeping fails, online or not", async () => {
    await onError({ config: { background: true }, response: { status: 500, data: { detail: "boom" } } });
    await onError({ config: { background: true }, message: "Network Error" });
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it("still signs out on a real 401, offline-tolerant or not", async () => {
    window.history.pushState({}, "", "/login"); // already there: no jsdom navigation
    await onError({ config: { offlineOk: true }, response: { status: 401 } });
    expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "auth/clearAuth" }));
  });
});
