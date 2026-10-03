import { createStore, del, entries, get, set } from "idb-keyval";

/**
 * Writes waiting to reach the server (journal memories, for now), kept in
 * IndexedDB so they survive the app closing with no signal.
 *
 * One entry per memory, keyed `<userId>:<memoryId>`:
 *   { userId, tripId, memoryId, op: "create" | "update" | "delete",
 *     body, queuedAt }
 * A second write to the same memory *merges* into its entry rather than
 * queueing behind it, so what's sent is always the memory's final state:
 *   create + update  -> create (with the new text)
 *   create + delete  -> nothing to send at all
 *   update + update  -> update (latest text)
 *   update + delete  -> delete
 * Only a memory's author can change it, so there's nothing to merge with
 * anyone else's edits.
 *
 * Best-effort like tripCache: without IndexedDB every call resolves quietly.
 */

let store;
function db() {
  store ??= createStore("pripritrip-outbox", "ops");
  return store;
}

async function safely(fn, fallback = null) {
  try {
    if (typeof indexedDB === "undefined") return fallback;
    return await fn();
  } catch {
    return fallback;
  }
}

const key = (userId, memoryId) => `${userId}:${memoryId}`;

/** Merge one more write for a memory into its pending entry (pure). */
export function mergeOp(existing, next) {
  if (!existing) return next;
  if (existing.op === "create") {
    if (next.op === "delete") return null; // never reached the server: nothing to do
    return { ...existing, body: { ...existing.body, ...next.body } }; // still a create
  }
  if (next.op === "delete") return { ...next, queuedAt: existing.queuedAt };
  return { ...existing, op: next.op, body: { ...existing.body, ...next.body } };
}

/** Queue a write ({ userId, tripId, memoryId, op, body }). */
export function enqueue(write) {
  if (!write.userId) return Promise.resolve();
  return safely(async () => {
    const k = key(write.userId, write.memoryId);
    const merged = mergeOp(await get(k, db()), { ...write, queuedAt: new Date().toISOString() });
    if (merged) await set(k, merged, db());
    else await del(k, db());
  });
}

/** This user's pending writes, oldest first. */
export function pending(userId) {
  if (!userId) return Promise.resolve([]);
  return safely(async () => {
    const all = (await entries(db())).map(([, v]) => v).filter((v) => v.userId === userId);
    return all.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }, []);
}

/** Drop a write once it has reached the server (or can never succeed). */
export function done(userId, memoryId) {
  if (!userId) return Promise.resolve();
  return safely(() => del(key(userId, memoryId), db()));
}

/** Forget this user's pending writes (an explicit sign-out). */
export function clearOutbox(userId) {
  if (!userId) return Promise.resolve();
  return safely(async () => {
    const mine = (await entries(db())).filter(([, v]) => v.userId === userId).map(([k]) => k);
    await Promise.all(mine.map((k) => del(k, db())));
  });
}

/**
 * Lay pending writes over the server's list for one trip, so the journal
 * shows what you wrote even before it syncs. Pending creates and updates
 * carry `pending: true`. Sorted the way the server sorts: createdAt, then id.
 */
export function applyPending(memories, ops, tripId) {
  const byId = new Map(memories.map((m) => [m.id, m]));
  for (const op of ops) {
    if (op.tripId !== tripId) continue;
    if (op.op === "delete") {
      byId.delete(op.memoryId);
      continue;
    }
    const current = byId.get(op.memoryId);
    if (op.op === "update" && !current) continue; // gone on the server meanwhile
    byId.set(op.memoryId, {
      ...(current ?? {
        id: op.memoryId,
        zone: op.body.zone,
        createdAt: op.body.createdAt,
        receivedAt: null,
        location: op.body.location ?? null,
        authorEmail: "",
        mine: true,
      }),
      ...("location" in op.body && op.op === "update" ? { location: null } : {}),
      text: op.body.text,
      updatedAt: op.op === "update" ? op.queuedAt : (current?.updatedAt ?? null),
      pending: true,
    });
  }
  return sortMemories([...byId.values()]);
}

/** The journal's order: when written (UTC instant), then id — as the server sorts. */
export function sortMemories(memories) {
  return [...memories].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
