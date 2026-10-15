import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OFFLINE_WRITE, apiClient, injectStore } from "@/shared/services/apiClient";

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

  it("never toasts a read that got no response: the offline bar and the page say so", async () => {
    await onError({ config: { method: "get" }, message: "Network Error" });
    await onError({ config: {}, message: "Network Error" }); // axios's default method is GET
    await onError({ config: { method: "get" }, code: "ECONNABORTED", message: "timeout of 0ms exceeded" });
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it("a write that couldn't go says so plainly, not \"Network Error\"", async () => {
    for (const method of ["post", "put", "delete"]) {
      await onError({ config: { method }, message: "Network Error" });
    }
    expect(store.dispatch).toHaveBeenCalledTimes(3);
    expect(store.dispatch).toHaveBeenCalledWith({ type: "error/setError", payload: OFFLINE_WRITE });
    expect(OFFLINE_WRITE).toBe("You’re offline, so that wasn’t saved.");
  });

  it("an outbox write (journal) that couldn't go stays quiet: it waits to send", async () => {
    await onError({ config: { method: "post", offlineOk: true }, message: "Network Error" });
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it("a read the server answered with an error still says so", async () => {
    await onError({ config: { method: "get" }, response: { status: 500, data: { detail: "boom" } } });
    expect(store.dispatch).toHaveBeenCalledWith({ type: "error/setError", payload: "boom" });
  });

  it("stays quiet when background housekeeping fails, online or not", async () => {
    await onError({ config: { background: true }, response: { status: 500, data: { detail: "boom" } } });
    await onError({ config: { background: true }, message: "Network Error" });
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it("leaves a status the caller handles to the caller, and only that status", async () => {
    const handles = [404, 409, 428];
    await onError({ config: { handles }, response: { status: 409, data: { detail: { version: 2 } } } });
    expect(store.dispatch).not.toHaveBeenCalled();
    await onError({ config: { handles }, response: { status: 500, data: { detail: "boom" } } });
    expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "error/setError" }));
  });

  it("still signs out on a real 401, offline-tolerant or not", async () => {
    window.history.pushState({}, "", "/login"); // already there: no jsdom navigation
    await onError({ config: { offlineOk: true }, response: { status: 401 } });
    expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "auth/clearAuth" }));
  });
});

describe("a 401 for someone in through a secret link (Run stage 31)", () => {
  const store = { dispatch: vi.fn(), getState: () => ({ auth: { token: "t" } }) };
  const real = window.location;
  function at(pathname) {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { pathname, assign } });
    return assign;
  }
  beforeEach(() => {
    store.dispatch.mockClear();
    injectStore(store);
    localStorage.clear();
  });
  afterEach(() => Object.defineProperty(window, "location", { configurable: true, value: real }));

  it("goes to the link-ended page, not the sign-in a guest has no password for", async () => {
    localStorage.setItem("auth_guest", "1");
    const assign = at("/trips/t1");
    await onError({ config: {}, response: { status: 401 } });
    expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "auth/clearAuth" }));
    expect(assign).toHaveBeenCalledWith("/link-ended");
  });

  it("anyone else still goes to sign-in", async () => {
    const assign = at("/trips/t1");
    await onError({ config: {}, response: { status: 401 } });
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("the link page itself is never sent away: it says what happened", async () => {
    localStorage.setItem("auth_guest", "1");
    const assign = at("/s/old-secret");
    await onError({ config: {}, response: { status: 401 } });
    expect(assign).not.toHaveBeenCalled();
  });
});
