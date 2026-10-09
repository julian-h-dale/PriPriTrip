import { createStore, del, entries, get, set } from "idb-keyval";

/**
 * Writes waiting to reach the server (journal memories and their photos),
 * kept in IndexedDB so they survive the app closing with no signal.
 *
 * One entry per memory, keyed `<userId>:<memoryId>`:
 *   { userId, tripId, memoryId, op: "create" | "update" | "delete",
 *     body, queuedAt }
 * and one per photo, keyed `<userId>:photo-<photoId>`:
 *   { ..., entryId: "photo-<id>", op: "addPhoto" | "removePhoto",
 *     body: { photoId, file?: { bytes, type, name } } }
 * (the file's bytes as an ArrayBuffer: every browser stores those; some
 * older iOS versions were unreliable with Blobs in IndexedDB). Entries are
 * sent oldest first, so a memory is always created before its photos.
 * A second write to the same memory *merges* into its entry rather than
 * queueing behind it, so what's sent is always the memory's final state:
 *   create + update  -> create (with the new text)
 *   create + delete  -> nothing to send at all
 *   update + update  -> update (latest text)
 *   update + delete  -> delete
 * Only a memory's author can change it, so there's nothing to merge with
 * anyone else's edits.
 *
 * An entry the server refused (a 4xx that isn't "try later") is never
 * dropped: it's marked `stuck: { status, message, at }` and kept until the
 * user removes it (Run stage 24). Stuck entries are left out of the
 * automatic retry; `unstick` puts them back in line. A new write to a stuck
 * memory clears its mark, since the edit may be the fix.
 *
 * Best-effort like tripCache: without IndexedDB every call resolves quietly,
 * except that `enqueue` says whether the write was kept.
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

const key = (userId, entryId) => `${userId}:${entryId}`;

/** A copy without its `stuck` mark. */
function unmarked(entry) {
  const copy = { ...entry };
  delete copy.stuck;
  return copy;
}
const entryOf = (write) => write.entryId ?? write.memoryId;

/** Merge one more write for a memory into its pending entry (pure). */
export function mergeOp(existing, next) {
  if (!existing) return next;
  if (existing.op === "addPhoto" && next.op === "removePhoto") return null; // never uploaded
  if (next.op === "addPhoto" || next.op === "removePhoto") return next;
  // A new write to a stuck memory clears its mark: the edit may be the fix.
  const kept = unmarked(existing);
  if (existing.op === "create") {
    if (next.op === "delete") return null; // never reached the server: nothing to do
    return { ...kept, body: { ...existing.body, ...next.body } }; // still a create
  }
  if (next.op === "delete") return { ...next, queuedAt: existing.queuedAt };
  return { ...kept, op: next.op, body: { ...existing.body, ...next.body } };
}

// Strictly increasing queue times, so writes queued in the same millisecond
// (several photos picked at once) still send in the order they were queued.
let lastQueued = 0;
function nextQueuedAt() {
  lastQueued = Math.max(Date.now(), lastQueued + 1);
  return new Date(lastQueued).toISOString();
}

let askedToKeep = false;
/**
 * Ask the browser not to clear this site's storage when the phone runs low
 * (the outbox can hold the only copy of a photo). Once per app start;
 * best-effort — a browser may say no, or not have the call at all.
 */
export async function askToKeepStorage() {
  if (askedToKeep) return;
  askedToKeep = true;
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      if (!(await navigator.storage.persisted?.())) await navigator.storage.persist();
    }
  } catch {
    // Refused or unsupported: the outbox works the same, just without the promise.
  }
}

/**
 * Queue a write ({ userId, tripId, memoryId, op, body, entryId? }). Deleting
 * a memory also drops any of its photos still waiting to upload. Resolves
 * true once the write is kept on the phone, false if it couldn't be (no
 * IndexedDB, or it refused: the phone is out of space).
 */
export function enqueue(write) {
  if (!write.userId) return Promise.resolve(false);
  return safely(async () => {
    const entryId = entryOf(write);
    const k = key(write.userId, entryId);
    const merged = mergeOp(await get(k, db()), { ...write, entryId, queuedAt: nextQueuedAt() });
    if (merged) await set(k, merged, db());
    else await del(k, db());
    if (write.op === "delete") {
      const photos = (await entries(db())).filter(
        ([, v]) => v.userId === write.userId && v.memoryId === write.memoryId && v.op === "addPhoto"
      );
      await Promise.all(photos.map(([k2]) => del(k2, db())));
    }
    askToKeepStorage();
    return true;
  }, false);
}

/** Mark a write the server refused ({ status, message }); it stays queued. */
export function markStuck(userId, entryId, { status, message }) {
  if (!userId) return Promise.resolve();
  return safely(async () => {
    const k = key(userId, entryId);
    const entry = await get(k, db());
    if (entry) await set(k, { ...entry, stuck: { status, message, at: new Date().toISOString() } }, db());
  });
}

/**
 * Put stuck writes back in line to be sent: these entries, or all of this
 * user's when `entryIds` is left out. Resolves to how many were stuck.
 */
export function unstick(userId, entryIds) {
  if (!userId) return Promise.resolve(0);
  return safely(async () => {
    const wanted = entryIds ? new Set(entryIds) : null;
    const stuck = (await entries(db())).filter(
      ([, v]) => v.userId === userId && v.stuck && (!wanted || wanted.has(entryOf(v)))
    );
    await Promise.all(stuck.map(([k, v]) => set(k, unmarked(v), db())));
    return stuck.length;
  }, 0);
}

/** This user's pending writes, oldest first (stuck ones included, marked). */
export function pending(userId) {
  if (!userId) return Promise.resolve([]);
  return safely(async () => {
    const all = (await entries(db())).map(([, v]) => v).filter((v) => v.userId === userId);
    return all.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }, []);
}

/** A photo still waiting to upload, as a File from the phone's stored copy (null if gone). */
export function pendingPhotoFile(userId, photoId) {
  if (!userId) return Promise.resolve(null);
  return safely(async () => {
    const file = (await get(key(userId, `photo-${photoId}`), db()))?.body?.file;
    return file ? new File([file.bytes], file.name, { type: file.type }) : null;
  });
}

/** Drop a write once it has reached the server (or can never succeed). */
export function done(userId, entryId) {
  if (!userId) return Promise.resolve();
  return safely(() => del(key(userId, entryId), db()));
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
  const photoOps = [];
  for (const op of ops) {
    if (op.tripId !== tripId) continue;
    if (op.op === "addPhoto" || op.op === "removePhoto") {
      photoOps.push(op);
      continue;
    }
    if (op.op === "delete") {
      byId.delete(op.memoryId);
      continue;
    }
    const current = byId.get(op.memoryId);
    if (op.op === "update" && !current) continue; // gone on the server meanwhile
    byId.set(op.memoryId, {
      ...(current ? unmarked(current) : {
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
      photos: current?.photos ?? [],
      pending: true,
      ...(op.stuck ? { stuck: op.stuck } : {}),
    });
  }
  for (const op of photoOps) {
    const memory = byId.get(op.memoryId);
    if (!memory) continue;
    const photos = (memory.photos ?? []).filter((p) => p.id !== op.body.photoId);
    if (op.op === "addPhoto") photos.push(pendingPhoto(op.body.photoId, op.body.file, op.stuck));
    byId.set(op.memoryId, { ...memory, photos });
  }
  return sortMemories([...byId.values()]);
}

/** The journal's order: when written (UTC instant), then id — as the server sorts. */
export function sortMemories(memories) {
  return [...memories].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * A photo still waiting to upload, shown from the phone's own copy. Its URLs
 * are object URLs (blob:) made from the stored bytes. `stuck` when the
 * server refused it.
 */
export function pendingPhoto(photoId, file, stuck = null) {
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
  } catch {
    // No object URLs (some test environments): it shows as a placeholder.
  }
  return {
    id: photoId,
    pending: true,
    ...(stuck ? { stuck } : {}),
    thumbUrl: url,
    displayUrl: url,
    originalUrl: url,
    width: null,
    height: null,
  };
}

