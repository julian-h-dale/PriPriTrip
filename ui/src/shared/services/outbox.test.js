import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyPending, clearOutbox, done, enqueue, markStuck, mergeOp, pending, sortMemories, unstick } from "@/shared/services/outbox";

const create = (text = "a") => ({ userId: "u1", tripId: "t1", memoryId: "m1", op: "create", body: { text, zone: "UTC", createdAt: "2026-05-11T18:00:00.000Z" } });
const update = (text) => ({ userId: "u1", tripId: "t1", memoryId: "m1", op: "update", body: { text } });
const remove = () => ({ userId: "u1", tripId: "t1", memoryId: "m1", op: "delete", body: {} });

describe("mergeOp: one entry per memory, always its final state", () => {
  it("create then update is still a create, with the new text", () => {
    expect(mergeOp(create("a"), update("b"))).toMatchObject({ op: "create", body: { text: "b", zone: "UTC" } });
  });
  it("create then delete leaves nothing to send", () => {
    expect(mergeOp(create(), remove())).toBeNull();
  });
  it("update then update keeps the latest text; update then delete is a delete", () => {
    expect(mergeOp(update("a"), update("b"))).toMatchObject({ op: "update", body: { text: "b" } });
    expect(mergeOp(update("a"), remove())).toMatchObject({ op: "delete" });
  });
});

describe("the outbox store", () => {
  beforeEach(async () => {
    await clearOutbox("u1");
    await clearOutbox("u2");
  });

  it("queues, merges, lists oldest first, and drops when done", async () => {
    await enqueue(create("first"));
    await enqueue({ ...create("second"), memoryId: "m2" });
    await enqueue(update("first, edited"));
    const ops = await pending("u1");
    expect(ops.map((o) => [o.memoryId, o.op, o.body.text])).toEqual([
      ["m1", "create", "first, edited"],
      ["m2", "create", "second"],
    ]);
    await done("u1", "m1");
    expect((await pending("u1")).map((o) => o.memoryId)).toEqual(["m2"]);
  });

  it("a create deleted before syncing disappears entirely", async () => {
    await enqueue(create());
    await enqueue(remove());
    expect(await pending("u1")).toEqual([]);
  });

  it("is per user", async () => {
    await enqueue(create());
    expect(await pending("u2")).toEqual([]);
    await clearOutbox("u1");
    expect(await pending("u1")).toEqual([]);
  });
});

describe("applyPending", () => {
  const server = [
    { id: "s1", text: "server", zone: "UTC", createdAt: "2026-05-11T19:00:00Z", mine: true },
    { id: "s2", text: "gone", zone: "UTC", createdAt: "2026-05-11T20:00:00Z", mine: true },
  ];
  it("adds pending creates in time order, applies edits and deletes, for this trip only", () => {
    const ops = [
      { ...create("written offline"), queuedAt: "x" },
      { tripId: "t1", memoryId: "s1", op: "update", body: { text: "server, edited" }, queuedAt: "2026-05-12T00:00:00Z" },
      { tripId: "t1", memoryId: "s2", op: "delete", body: {}, queuedAt: "y" },
      { ...create("other trip"), memoryId: "m9", tripId: "t2", queuedAt: "z" },
    ];
    const merged = applyPending(server, ops, "t1");
    expect(merged.map((m) => [m.id, m.text, Boolean(m.pending)])).toEqual([
      ["m1", "written offline", true], // 18:00, before the server's 19:00 one
      ["s1", "server, edited", true],
    ]);
  });
  it("sorts by instant then id, like the server", () => {
    const same = "2026-05-11T18:00:00Z";
    expect(sortMemories([{ id: "b", createdAt: same }, { id: "a", createdAt: same }]).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("photos in the outbox", () => {
  beforeEach(() => clearOutbox("u1"));
  const addPhoto = (photoId) => ({
    userId: "u1",
    tripId: "t1",
    memoryId: "m1",
    entryId: `photo-${photoId}`,
    op: "addPhoto",
    body: { photoId, file: { bytes: new ArrayBuffer(3), type: "image/jpeg", name: "a.jpg" } },
  });

  it("are their own entries, sent after the memory they belong to", async () => {
    await enqueue(create());
    await enqueue(addPhoto("p1"));
    await enqueue(addPhoto("p2"));
    expect((await pending("u1")).map((o) => o.op)).toEqual(["create", "addPhoto", "addPhoto"]);
  });

  it("photos queued in the same millisecond still send in the order picked", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-05-11T18:00:00Z") });
    try {
      const ids = ["p9", "p1", "p5", "p3", "p7"]; // keys in IndexedDB sort differently
      for (const id of ids) await enqueue(addPhoto(id));
      expect((await pending("u1")).map((o) => o.body.photoId)).toEqual(ids);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removing a photo that never uploaded leaves nothing to send", async () => {
    await enqueue(addPhoto("p1"));
    await enqueue({ ...addPhoto("p1"), op: "removePhoto", body: { photoId: "p1" } });
    expect(await pending("u1")).toEqual([]);
  });

  it("deleting a memory drops its photos still waiting to upload", async () => {
    await enqueue({ ...create(), op: "update", body: { text: "x" } }); // already on the server
    await enqueue(addPhoto("p1"));
    await enqueue(remove());
    expect((await pending("u1")).map((o) => o.op)).toEqual(["delete"]);
  });
});

describe("stuck writes (Run stage 24)", () => {
  beforeEach(async () => {
    await clearOutbox("u1");
  });

  it("enqueue says whether the write was kept", async () => {
    expect(await enqueue(create())).toBe(true);
    expect(await enqueue({ ...create(), userId: null })).toBe(false);
  });

  it("markStuck keeps the entry, marked; unstick puts it back in line", async () => {
    await enqueue(create());
    await enqueue({ ...create(), memoryId: "m2" });
    await markStuck("u1", "m1", { status: 422, message: "no" });
    expect((await pending("u1")).map((o) => [o.memoryId, o.stuck?.status ?? null])).toEqual([
      ["m1", 422],
      ["m2", null],
    ]);
    expect((await pending("u1"))[0].stuck.at).toMatch(/^\d{4}-/);
    expect(await unstick("u1", ["m2"])).toBe(0);
    expect(await unstick("u1")).toBe(1);
    expect((await pending("u1")).every((o) => !o.stuck)).toBe(true);
  });

  it("a new write to a stuck memory clears its mark; removing a stuck photo still cancels it", () => {
    const stuck = { status: 422, message: "no", at: "2026-10-08T00:00:00Z" };
    expect(mergeOp({ ...create("a"), stuck }, update("b")).stuck).toBeUndefined();
    expect(mergeOp({ ...update("a"), stuck }, update("b")).stuck).toBeUndefined();
    const photo = { userId: "u1", tripId: "t1", memoryId: "m1", entryId: "photo-p1", op: "addPhoto", body: { photoId: "p1" }, stuck };
    expect(mergeOp(photo, { ...photo, op: "removePhoto", stuck: undefined })).toBeNull();
  });

  it("applyPending draws stuck memories and photos, marked", () => {
    const stuck = { status: 422, message: "no", at: "2026-10-08T00:00:00Z" };
    const ops = [
      { ...create("refused"), stuck, queuedAt: "2026-10-08T00:00:00.000Z" },
      {
        userId: "u1",
        tripId: "t1",
        memoryId: "m1",
        entryId: "photo-p1",
        op: "addPhoto",
        body: { photoId: "p1", file: { bytes: new ArrayBuffer(1), type: "image/jpeg", name: "p.jpg" } },
        stuck,
        queuedAt: "2026-10-08T00:00:01.000Z",
      },
    ];
    const [memory] = applyPending([], ops, "t1");
    expect(memory).toMatchObject({ id: "m1", text: "refused", pending: true, stuck });
    expect(memory.photos).toMatchObject([{ id: "p1", pending: true, stuck }]);
  });

  it("asks the browser to keep its storage, once", async () => {
    vi.resetModules();
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => false);
    Object.defineProperty(navigator, "storage", { value: { persist, persisted }, configurable: true });
    try {
      const fresh = await import("@/shared/services/outbox");
      await fresh.enqueue(create());
      await fresh.enqueue(update("again"));
      await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
      await fresh.clearOutbox("u1");
    } finally {
      delete navigator.storage;
    }
  });
});
