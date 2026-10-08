import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyChanges,
  clearPackingQueue,
  mergeChange,
  queueChange,
  queueListDelete,
  waitingChanges,
} from "@/shared/services/packingQueue";

const U = "user-1";
const T = "trip-1";
const line = (id, category, text, position, checked = false) => ({ id, category, text, position, checked, quantity: 1 });

beforeEach(() => clearPackingQueue(U));

describe("mergeChange: what's sent is a line's last state", () => {
  const create = { op: "create", body: { category: "clothes", text: "Hat" } };
  it("create + update is a create with the change; create + delete is nothing", () => {
    expect(mergeChange(create, { op: "update", body: { checked: true } }).body).toEqual({ category: "clothes", text: "Hat", checked: true });
    expect(mergeChange(create, { op: "delete" })).toBeNull();
  });
  it("update + update keeps both; update + delete is a delete", () => {
    const update = { op: "update", body: { text: "Cap" }, queuedAt: "1" };
    expect(mergeChange(update, { op: "update", body: { checked: true } }).body).toEqual({ text: "Cap", checked: true });
    expect(mergeChange(update, { op: "delete", queuedAt: "2" })).toMatchObject({ op: "delete", queuedAt: "1" });
  });
});

describe("the queue", () => {
  it("keeps changes per line, oldest first, and per user and trip", async () => {
    await queueChange({ userId: U, tripId: T, itemId: "a", op: "update", body: { checked: true } });
    await queueChange({ userId: U, tripId: T, itemId: "n", op: "create", body: { category: "other", text: "Book" } });
    await queueChange({ userId: U, tripId: T, itemId: "a", op: "update", body: { checked: false } });
    await queueChange({ userId: "someone-else", tripId: T, itemId: "z", op: "delete" });
    const mine = await waitingChanges(U, T);
    expect(mine.map((c) => [c.itemId, c.op, c.body])).toEqual([
      ["a", "update", { checked: false }],
      ["n", "create", { category: "other", text: "Book" }],
    ]);
  });

  it("deleting a list drops what's waiting for its lines; a line added after goes after it", async () => {
    await queueChange({ userId: U, tripId: T, itemId: "a", op: "update", body: { checked: true } });
    await queueListDelete({ userId: U, tripId: T, category: "clothes", itemIds: ["a", "b"] });
    await queueChange({ userId: U, tripId: T, itemId: "n", op: "create", body: { category: "clothes", text: "Hat" } });
    expect((await waitingChanges(U, T)).map((c) => c.op)).toEqual(["deleteList", "create"]);
  });
});

describe("applyChanges: the list as it will be", () => {
  const list = [line("a", "clothes", "Socks", 0), line("b", "clothes", "Shirt", 1), line("c", "other", "Book", 0)];
  it("ticks, adds at the end of their list, and deletes", () => {
    const out = applyChanges(list, [
      { op: "update", itemId: "a", body: { checked: true } },
      { op: "create", itemId: "n", body: { category: "clothes", text: "Hat", quantity: 2 } },
      { op: "delete", itemId: "c" },
    ]);
    expect(out.map((i) => [i.id, i.text, i.checked, i.position])).toEqual([
      ["a", "Socks", true, 0],
      ["b", "Shirt", false, 1],
      ["n", "Hat", false, 2],
    ]);
  });
  it("a deleted list goes, and an add already on the server isn't doubled", () => {
    const out = applyChanges(list, [
      { op: "deleteList", category: "clothes" },
      { op: "create", itemId: "c", body: { category: "other", text: "Book" } },
    ]);
    expect(out.map((i) => i.id)).toEqual(["c"]);
  });
});
