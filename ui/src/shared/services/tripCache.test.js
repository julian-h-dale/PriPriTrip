import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearAll,
  clearUser,
  readTrip,
  readTripList,
  removeTrip,
  saveTrip,
  saveTripList,
} from "@/shared/services/tripCache";

describe("tripCache", () => {
  beforeEach(() => clearAll());

  it("round-trips a user's list and trips, with when they were saved", async () => {
    await saveTripList("u1", [{ id: "t1" }]);
    await saveTrip("u1", { id: "t1", name: "Bern" });
    const list = await readTripList("u1");
    const trip = await readTrip("u1", "t1");
    expect(list.data).toEqual([{ id: "t1" }]);
    expect(trip.data.name).toBe("Bern");
    expect(Number.isNaN(Date.parse(trip.savedAt))).toBe(false);
  });

  it("never reads another user's trips", async () => {
    await saveTripList("u1", [{ id: "t1" }]);
    await saveTrip("u1", { id: "t1" });
    expect(await readTripList("u2")).toBeFalsy();
    expect(await readTrip("u2", "t1")).toBeFalsy();
  });

  it("clears only the signed-out user's copy", async () => {
    await saveTripList("u1", [{ id: "t1" }]);
    await saveTrip("u1", { id: "t1" });
    await saveTrip("u2", { id: "t2" });
    await clearUser("u1");
    expect(await readTripList("u1")).toBeFalsy();
    expect(await readTrip("u1", "t1")).toBeFalsy();
    expect((await readTrip("u2", "t2")).data).toEqual({ id: "t2" });
  });

  it("removes one trip", async () => {
    await saveTrip("u1", { id: "t1" });
    await removeTrip("u1", "t1");
    expect(await readTrip("u1", "t1")).toBeFalsy();
  });

  it("does nothing without a user id", async () => {
    await saveTrip(null, { id: "t1" });
    expect(await readTrip(null, "t1")).toBeNull();
  });
});
