import { createStore, del, entries, get, set } from "idb-keyval";

/**
 * Packing changes waiting to reach the server (Run stage 21), kept in
 * IndexedDB like the journal's outbox, so ticking and adding work offline
 * (and with "Use saved copies only" on).
 *
 * One entry per line, keyed `<userId>:<tripId>:<itemId>`:
 *   { userId, tripId, itemId, op: "create" | "update" | "delete", body, queuedAt }
 * and one per deleted list, keyed `<userId>:<tripId>:list:<category>`:
 *   { ..., op: "deleteList", category }
 * A second change to the same line *merges* into its entry, so what's sent
 * is the line's last state:
 *   create + update -> create (with the change)    create + delete -> nothing
 *   update + update -> update (both changes)       update + delete -> delete
 * Deleting a list drops what's waiting for the lines on it (it deletes them
 * all); a line added to that list afterwards is queued after it.
 * Entries are sent oldest first. Best-effort: without IndexedDB every call
 * resolves quietly.
 */

let store;
function db() {
  store ??= createStore("pripritrip-packing", "ops");
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

let lastQueued = 0;
function nextQueuedAt() {
  lastQueued = Math.max(Date.now(), lastQueued + 1);
  return new Date(lastQueued).toISOString();
}

/** One more change for a line, merged into what's waiting for it (pure). */
export function mergeChange(existing, next) {
  if (!existing) return next;
  if (existing.op === "create") {
    if (next.op === "delete") return null; // never reached the server
    return { ...existing, body: { ...existing.body, ...next.body } };
  }
  if (next.op === "delete") return { ...next, queuedAt: existing.queuedAt };
  return { ...existing, body: { ...existing.body, ...next.body } };
}

/** Queue a change to one line: { userId, tripId, itemId, op, body }. */
export function queueChange(change) {
  if (!change.userId) return Promise.resolve();
  return safely(async () => {
    const key = `${change.userId}:${change.tripId}:${change.itemId}`;
    const merged = mergeChange(await get(key, db()), { ...change, queuedAt: nextQueuedAt() });
    if (merged) await set(key, merged, db());
    else await del(key, db());
  });
}

/** Queue deleting a list, dropping what's waiting for its lines (`itemIds`). */
export function queueListDelete({ userId, tripId, category, itemIds }) {
  if (!userId) return Promise.resolve();
  return safely(async () => {
    await Promise.all(itemIds.map((id) => del(`${userId}:${tripId}:${id}`, db())));
    await set(
      `${userId}:${tripId}:list:${category}`,
      { userId, tripId, category, op: "deleteList", queuedAt: nextQueuedAt() },
      db(),
    );
  });
}

/** What's waiting for `userId` (one trip, or all), oldest first, with keys. */
export async function waitingChanges(userId, tripId = null) {
  if (!userId) return [];
  const all = await safely(() => entries(db()), []);
  return all
    .filter(([, c]) => c.userId === userId && (tripId == null || c.tripId === tripId))
    .sort(([, a], [, b]) => (a.queuedAt < b.queuedAt ? -1 : 1))
    .map(([key, change]) => ({ key, ...change }));
}

export function changeSent(key) {
  return safely(() => del(key, db()));
}

/** Forget one user's waiting changes (on sign-out). */
export async function clearPackingQueue(userId) {
  for (const { key } of await waitingChanges(userId)) await changeSent(key);
}

/** The list as it will be once the waiting changes land (pure). */
export function applyChanges(items, changes) {
  let list = items.map((i) => ({ ...i }));
  for (const c of changes) {
    if (c.op === "deleteList") list = list.filter((i) => i.category !== c.category);
    else if (c.op === "delete") list = list.filter((i) => i.id !== c.itemId);
    else if (c.op === "create") {
      if (list.some((i) => i.id === c.itemId)) continue; // it got there already
      const position = Math.max(-1, ...list.filter((i) => i.category === c.body.category).map((i) => i.position)) + 1;
      list.push({ id: c.itemId, checked: false, quantity: 1, position, ...c.body, waiting: true });
    } else {
      const item = list.find((i) => i.id === c.itemId);
      if (item) Object.assign(item, c.body, { waiting: true });
    }
  }
  return list;
}
