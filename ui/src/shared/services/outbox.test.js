import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { applyPending, clearOutbox, done, enqueue, mergeOp, pending, sortMemories } from "@/shared/services/outbox";

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
