import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_ONLY, SAVED_ONLY_WRITE, apiClient, injectStore } from "@/shared/services/apiClient";

/**
 * "Use saved copies only" (Run stage 20): nothing leaves the phone. The
 * adapter stands in for the network: if it's called, a request went out.
 */
const adapter = vi.fn(async (config) => ({ data: {}, status: 200, statusText: "OK", headers: {}, config }));
apiClient.defaults.adapter = adapter;

function storeWith({ savedOnly, token = "t", refreshing = false }) {
  const store = {
    dispatch: vi.fn(),
    getState: () => ({ auth: { token }, network: { online: true, savedOnly, refreshing } }),
  };
  injectStore(store);
  return store;
}

beforeEach(() => adapter.mockClear());

describe("apiClient with saved copies only", () => {
  it("refuses every request before it's sent, like having no connection", async () => {
    const store = storeWith({ savedOnly: true });
    const err = await apiClient.get("/trips/trip-1", { silent: true, offlineOk: true }).catch((e) => e);
    expect(err.code).toBe(SAVED_ONLY);
    expect(err.response).toBeUndefined(); // so pages fall back to their saved copy
    expect(adapter).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled(); // a read: no toast
  });

  it("says why a write didn't go", async () => {
    const store = storeWith({ savedOnly: true });
    await apiClient.put("/trips/trip-1/items/i1", { title: "x" }).catch(() => {});
    expect(adapter).not.toHaveBeenCalled();
    expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: SAVED_ONLY_WRITE }));
  });

  it("still lets someone sign in, and ask who they are", async () => {
    storeWith({ savedOnly: true, token: null });
    await apiClient.post("/auth/login", "username=a&password=b");
    storeWith({ savedOnly: true });
    await apiClient.get("/users/me");
    expect(adapter.mock.calls.map(([c]) => c.url)).toEqual(["/auth/login", "/users/me"]);
  });

  it("lets requests out during a Refresh once", async () => {
    storeWith({ savedOnly: true, refreshing: true });
    await apiClient.get("/trips");
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("sends as usual with it off", async () => {
    storeWith({ savedOnly: false });
    await apiClient.get("/trips");
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});
