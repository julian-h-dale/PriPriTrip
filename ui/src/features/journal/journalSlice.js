import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { deviceZone } from "@/features/journal/journalDays";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";
import {
  applyPending,
  done,
  enqueue,
  markStuck,
  pending,
  pendingPhoto,
  sortMemories,
  unstick,
} from "@/shared/services/outbox";
import { readMemories, saveMemories } from "@/shared/services/tripCache";
import { userIdFromToken } from "@/shared/utils/authToken";
import { selectMaySend, selectOnline } from "@/shared/networkSlice";

/**
 * One trip's journal, written offline-first.
 *
 * Every write — online or not — lands on screen at once, goes into the
 * phone's outbox (shared/services/outbox.js), and is then sent by
 * `syncOutbox`. The phone makes each memory's id and `createdAt` (UTC, when
 * Save was tapped), so a retry can't duplicate it and the journal's order is
 * when things were written. Reads are stale-while-revalidate: the saved copy,
 * then the server's list, with anything still in the outbox laid over it.
 */

const userOf = (getState) => userIdFromToken(getState().auth?.token);

export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Save the offline copy: what the server has confirmed (pending writes live in the outbox). */
async function persist(getState) {
  const { tripId, items } = getState().journal;
  if (!tripId) return;
  const confirmed = items
    .filter((m) => !m.pending)
    .map((m) => ({ ...m, photos: (m.photos ?? []).filter((p) => !p.pending) }));
  await saveMemories(userOf(getState), tripId, confirmed);
}

/** A file's bytes (FileReader where Blob.arrayBuffer is missing — older Safari). */
function readBytes(file) {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** A picked photo as outbox-ready bytes, with the id it will keep. */
async function toPhotoEntry(file) {
  return {
    photoId: crypto.randomUUID(),
    file: { bytes: await readBytes(file), type: file.type || "image/jpeg", name: file.name || "photo.jpg" },
  };
}

/**
 * Recount what's waiting: memory writes (sent automatically), photos (sent
 * on Upload), and writes the server refused (stuck: kept, sent again only
 * when asked).
 */
async function refreshPendingCount(dispatch, getState) {
  const ops = await pending(userOf(getState));
  const stuck = ops.filter((op) => op.stuck);
  const photos = ops.filter((op) => op.op === "addPhoto" && !op.stuck);
  dispatch(
    pendingCountChanged({
      memories: ops.filter((op) => !isPhotoOp(op) && !op.stuck).length,
      photos: photos.length,
      photoBytes: photos.reduce((n, op) => n + (op.body.file?.bytes?.byteLength ?? 0), 0),
      stuck: stuck.length,
    })
  );
}

export const fetchMemories = createAsyncThunk(
  "journal/fetch",
  async (tripId, { dispatch, getState, rejectWithValue }) => {
    const userId = userOf(getState);
    const cached = await readMemories(userId, tripId);
    if (cached) {
      dispatch(memoriesLoaded({ tripId, items: applyPending(cached.data, await pending(userId), tripId) }));
    }
    // What's waiting *before* asking the server: if one of these is sent
    // while the request is in flight, the server's answer can predate it
    // while the outbox no longer has it — keep the copy on screen then,
    // or the memory would blink out of the journal until the next refresh.
    const before = new Set((await pending(userId)).map((op) => op.memoryId));
    // The counts behind Upload and "couldn't upload", right even when the app
    // starts offline. After `before`, so the snapshot above stays first.
    refreshPendingCount(dispatch, getState);
    try {
      const { data } = await apiClient.get(`/trips/${tripId}/memories`, { silent: true, offlineOk: true });
      await saveMemories(userId, tripId, data);
      const after = await pending(userId);
      // Memory writes only: photos waiting for Upload don't make the memory itself unsent.
      const stillQueued = new Set(after.filter((op) => !isPhotoOp(op)).map((op) => op.memoryId));
      const onServer = new Set(data.map((m) => m.id));
      const { items, tripId: shown } = getState().journal;
      const syncedMeanwhile =
        shown === tripId
          ? items.filter((m) => before.has(m.id) && !stillQueued.has(m.id) && !onServer.has(m.id) && !m.pending)
          : [];
      return applyPending([...data, ...syncedMeanwhile], after, tripId);
    } catch (err) {
      return rejectWithValue(!err.response && cached ? "offline" : "failed");
    }
  }
);

const quiet = { silent: true, offlineOk: true };
const SEND = {
  create: (op) =>
    apiClient.post(
      `/trips/${op.tripId}/memories`,
      {
        id: op.memoryId,
        createdAt: op.body.createdAt,
        text: op.body.text,
        zone: op.body.zone,
        location: op.body.location ?? null,
        isPublic: op.body.isPublic ?? false,
      },
      quiet
    ),
  // `location: null` only when the edit removed it, and `isPublic` only when
  // the edit set it; otherwise each is left out (kept). An edit queued before
  // public memories existed has neither.
  update: (op) =>
    apiClient.put(
      `/trips/${op.tripId}/memories/${op.memoryId}`,
      {
        text: op.body.text,
        ...("isPublic" in op.body ? { isPublic: op.body.isPublic } : {}),
        ...("location" in op.body ? { location: null } : {}),
      },
      quiet
    ),
  delete: (op) => apiClient.delete(`/trips/${op.tripId}/memories/${op.memoryId}`, quiet),
  // The photo keeps the id the phone gave it, so a retried upload can't duplicate.
  addPhoto: (op) => {
    const form = new FormData();
    form.append("id", op.body.photoId);
    form.append("file", new Blob([op.body.file.bytes], { type: op.body.file.type }), op.body.file.name);
    return apiClient.post(`/trips/${op.tripId}/memories/${op.memoryId}/photos`, form, quiet);
  },
  removePhoto: (op) =>
    apiClient.delete(`/trips/${op.tripId}/memories/${op.memoryId}/photos/${op.body.photoId}`, quiet),
};

const isPhotoOp = (op) => op.op === "addPhoto" || op.op === "removePhoto";
const entryOf = (op) => op.entryId ?? op.memoryId;

/**
 * What a failed send means. "later": no answer, signed out (401), a password
 * to change first (403 PASSWORD_CHANGE_REQUIRED), busy (408, 429) or a
 * server error — kept, and tried again on the usual triggers. "stuck": the
 * server refused this write (any other 4xx) — kept, marked, and sent again
 * only when asked. Nothing is ever dropped for failing.
 */
export function outcomeOf(err) {
  const status = err.response?.status;
  if (!status || status === 401 || status === 408 || status === 429 || status >= 500) return "later";
  if (status === 403 && err.response?.data?.detail === "PASSWORD_CHANGE_REQUIRED") return "later";
  return "stuck";
}

/** The server's reason, for the stuck mark: { status, message }. */
function refusal(err) {
  const status = err.response.status;
  const detail = err.response.data?.detail;
  const message =
    typeof detail === "string" ? detail : Array.isArray(detail) && detail[0]?.msg ? detail[0].msg : `Refused (${status})`;
  return { status, message };
}

/** An outbox entry fit for a Redux action: a photo's bytes stay out of the store. */
const forAction = (op) => (isPhotoOp(op) ? { ...op, body: { photoId: op.body.photoId } } : op);

let syncing = null;

/**
 * Send the outbox, oldest first. Photos wait on the phone until the user
 * taps Upload (`{ photos: true }`, see `uploadPhotos`): a web app can't tell
 * Wi-Fi from cellular, so they choose when. `photos` can also be a list of
 * photo entry ids (one stuck photo's Try again). Everything else — memories,
 * edits, deletes, photo removals — goes whenever this runs.
 *
 * Stops at the first failure worth trying again later (`outcomeOf`). A
 * write the server refuses is marked stuck and kept (Run stage 24): it isn't
 * sent again until asked (`retryStuck`, Upload, or once after an app
 * update), and a memory's later writes — its photos too — wait behind a
 * stuck one, so a refused memory can't take its photos with it. One sync
 * runs at a time; a request during one runs again after it.
 */
export const syncOutbox =
  ({ photos = false } = {}) =>
  (dispatch, getState) => {
    // Asked again mid-sync (e.g. the connection just came back while an
    // offline pass was finishing): run once more right after, never drop it.
    if (syncing) return syncing.then(() => dispatch(syncOutbox({ photos })));
    const sendsPhoto = (op) => photos === true || (Array.isArray(photos) && photos.includes(entryOf(op)));
    syncing = (async () => {
      try {
        const userId = userOf(getState);
        const all = await pending(userId);
        // A memory whose own write is stuck holds everything after it.
        const held = new Set(all.filter((op) => op.stuck && !isPhotoOp(op)).map((op) => op.memoryId));
        const ops = all.filter((op) => !op.stuck && (op.op !== "addPhoto" || sendsPhoto(op)));
        const uploads = ops.filter((op) => op.op === "addPhoto" && !held.has(op.memoryId)).length;
        if (uploads) dispatch(uploadProgress({ done: 0, total: uploads }));
        let uploaded = 0;
        for (const op of ops) {
          if (!selectMaySend(getState())) break;
          if (held.has(op.memoryId)) continue;
          try {
            const { data } = await SEND[op.op](op);
            await done(userId, entryOf(op));
            dispatch(synced({ op: forAction(op), data: data ?? null }));
            if (op.op === "addPhoto") dispatch(uploadProgress({ done: ++uploaded, total: uploads }));
          } catch (err) {
            if (outcomeOf(err) === "later") break; // try again later
            const stuck = refusal(err);
            await markStuck(userId, entryOf(op), stuck);
            if (!isPhotoOp(op)) held.add(op.memoryId);
            dispatch(syncFailed({ op: forAction(op), stuck: { ...stuck, at: new Date().toISOString() } }));
            dispatch(
              notify({
                type: "error",
                message: isPhotoOp(op)
                  ? "A photo couldn’t be uploaded. It’s still on this phone."
                  : "A memory couldn’t be saved. It’s still on this phone.",
              })
            );
          }
        }
        await persist(getState);
        await refreshPendingCount(dispatch, getState);
      } finally {
        dispatch(uploadProgress(null));
        syncing = null;
      }
    })();
    return syncing;
  };

/** Put stuck writes back in line (these entries, or all of them) and say so on screen. */
async function unstickAll(dispatch, getState, entryIds) {
  const userId = userOf(getState);
  const stuck = (await pending(userId)).filter((op) => op.stuck && (!entryIds || entryIds.includes(entryOf(op))));
  await unstick(userId, entryIds);
  dispatch(stuckCleared(entryIds ?? null));
  return stuck;
}

/**
 * Send stuck writes again: one entry's (`[memoryId]` or `["photo-<id>"]`)
 * or, left out, every one ("Try all again"). Only the stuck photos go, not
 * every photo waiting for Upload. One refused again stays stuck with the
 * new reason.
 */
export const retryStuck = (entryIds) => async (dispatch, getState) => {
  const retried = await unstickAll(dispatch, getState, entryIds);
  await dispatch(
    syncOutbox({ photos: retried.filter((op) => op.op === "addPhoto").map(entryOf) })
  );
  const left = getState().journal.stuckCount ?? 0;
  if (retried.length && left === 0) dispatch(notify({ type: "success", message: "Uploaded" }));
};

/** Give up on a stuck write: the only way one is deleted (the screen asked first). */
export const removeStuck =
  ({ tripId, entryId }) =>
  async (dispatch, getState) => {
    const userId = userOf(getState);
    const entry = (await pending(userId)).find((op) => entryOf(op) === entryId);
    await done(userId, entryId);
    // A memory that never reached the server takes its waiting photos with it
    // (the screen said so): sent alone, they'd only be refused.
    if (entry?.op === "create") {
      const photos = (await pending(userId)).filter((op) => op.memoryId === entry.memoryId && isPhotoOp(op));
      for (const op of photos) await done(userId, entryOf(op));
    }
    dispatch(stuckRemoved({ tripId, entryId }));
    await refreshPendingCount(dispatch, getState);
    dispatch(fetchMemories(tripId)); // an edit given up on shows the server's copy again
  };

/* global __BUILD_ID__ */
const BUILD_ID = typeof __BUILD_ID__ === "undefined" ? "dev" : __BUILD_ID__;
const BUILD_KEY = "pripritrip-last-build";

/**
 * Once after the app updates (a new build id), stuck writes are put back in
 * line: a new version is when a fix arrives. Memories go at once; photos go
 * back to waiting for Upload (which may be on cellular). Not again on the
 * next start of the same version.
 */
export const retryAfterUpdate = () => async (dispatch, getState) => {
  let seen = null;
  try {
    seen = localStorage.getItem(BUILD_KEY);
    localStorage.setItem(BUILD_KEY, BUILD_ID);
  } catch {
    return; // no storage: no way to tell an update apart, so no retry
  }
  if (seen === null || seen === BUILD_ID) return;
  if ((await unstickAll(dispatch, getState)).length) await refreshPendingCount(dispatch, getState);
};

/** Upload the photos waiting on this phone (and anything else queued), then say how it went. */
export const uploadPhotos = () => async (dispatch, getState) => {
  // Upload is also a resync: stuck writes get one more try.
  await unstickAll(dispatch, getState);
  await dispatch(syncOutbox({ photos: true }));
  const left = getState().journal.waitingPhotos.count;
  const stuck = getState().journal.stuckCount ?? 0;
  const stuckNote = stuck
    ? `${stuck} couldn’t upload: ${stuck === 1 ? "it’s" : "they’re"} still on this phone, see the journal.`
    : "";
  if (left > 0) {
    dispatch(
      notify({
        type: "error",
        message: `Upload stopped: ${left} ${left === 1 ? "photo is" : "photos are"} still on this phone. Tap Upload to carry on.${stuckNote ? ` ${stuckNote}` : ""}`,
      })
    );
  } else if (stuck > 0) {
    dispatch(notify({ type: "error", message: stuckNote }));
  } else {
    dispatch(notify({ type: "success", message: "Photos uploaded" }));
  }
};

const isOnline = (getState) => selectOnline(getState());

const NOT_KEPT =
  "This phone couldn’t save it (it may be out of space) and it couldn’t be sent. Copy your words, free up space, then save it again.";

/**
 * Queue a write; if the phone can't keep it (no IndexedDB, or out of
 * space), send it now instead. "queued" | "sent" | "lost" — lost means it
 * exists only on screen, which the memory then says (`unsaved`).
 */
async function keepOrSend(dispatch, getState, write) {
  if (await enqueue(write)) return "queued";
  if (selectMaySend(getState())) {
    try {
      const { data } = await SEND[write.op](write);
      dispatch(synced({ op: forAction(write), data: data ?? null }));
      return "sent";
    } catch {
      // Falls through: neither kept nor sent.
    }
  }
  dispatch(notSaved({ tripId: write.tripId, memoryId: write.memoryId, photoId: write.body?.photoId ?? null }));
  return "lost";
}

/** Viewers follow along (public memories only) and don't write; the owner and editors do. */
export const canWriteMemories = (trip) => Boolean(trip) && trip.role !== "viewer";

/**
 * Write a new memory: on screen now, sent when there's a connection.
 * `location` ({ lat, lng, accuracy } or null) is where the phone was.
 */
export const createMemory =
  ({ tripId, text, location = null, files = [], isPublic = false }) =>
  async (dispatch, getState) => {
    const photos = await Promise.all(files.map(toPhotoEntry));
    const memory = {
      id: crypto.randomUUID(),
      text,
      zone: deviceZone(),
      createdAt: new Date().toISOString(), // the moment Save was tapped
      updatedAt: null,
      receivedAt: null,
      location,
      isPublic,
      photos: photos.map((p) => pendingPhoto(p.photoId, p.file)),
      authorEmail: getState().auth?.user?.email ?? "",
      mine: true,
      pending: true,
    };
    dispatch(localWrite({ tripId, op: "create", memory }));
    const outcomes = [
      await keepOrSend(dispatch, getState, {
        userId: userOf(getState),
        tripId,
        memoryId: memory.id,
        op: "create",
        body: { text, zone: memory.zone, createdAt: memory.createdAt, location, isPublic },
      }),
    ];
    // Queued after the memory, so they're sent after it exists.
    for (const p of photos) {
      outcomes.push(
        await keepOrSend(dispatch, getState, {
          userId: userOf(getState),
          tripId,
          memoryId: memory.id,
          entryId: `photo-${p.photoId}`,
          op: "addPhoto",
          body: p,
        })
      );
    }
    await refreshPendingCount(dispatch, getState);
    if (outcomes.includes("lost")) {
      dispatch(notify({ type: "error", message: NOT_KEPT }));
      return memory;
    }
    dispatch(
      notify({
        type: "success",
        message: isOnline(getState)
          ? "Memory saved"
          : getState().network?.savedOnly
            ? "Saved on this phone — it’ll sync when “Use saved copies only” is off"
            : "Saved on this phone — it’ll sync when you’re online",
      })
    );
    dispatch(syncOutbox());
    return memory;
  };

/**
 * Change your memory's words, who sees it (`isPublic`; left out, it stays),
 * and optionally drop its location; its time and place in the journal stay.
 * A location is never added on an edit.
 */
export const updateMemory =
  ({ tripId, id, text, isPublic, clearLocation = false, addFiles = [], removePhotoIds = [] }) =>
  async (dispatch, getState) => {
    const added = await Promise.all(addFiles.map(toPhotoEntry));
    const current = getState().journal.items.find((m) => m.id === id);
    const photos = [
      ...(current?.photos ?? []).filter((p) => !removePhotoIds.includes(p.id)),
      ...added.map((p) => pendingPhoto(p.photoId, p.file)),
    ];
    const changes = {
      id,
      text,
      photos,
      updatedAt: new Date().toISOString(),
      ...(isPublic === undefined ? {} : { isPublic }),
      ...(clearLocation ? { location: null } : {}),
    };
    dispatch(localWrite({ tripId, op: "update", memory: changes }));
    const userId = userOf(getState);
    const outcomes = [
      await keepOrSend(dispatch, getState, {
        userId,
        tripId,
        memoryId: id,
        op: "update",
        body: {
          text,
          ...(isPublic === undefined ? {} : { isPublic }),
          ...(clearLocation ? { location: null } : {}),
        },
      }),
    ];
    for (const photoId of removePhotoIds) {
      outcomes.push(
        await keepOrSend(dispatch, getState, { userId, tripId, memoryId: id, entryId: `photo-${photoId}`, op: "removePhoto", body: { photoId } })
      );
    }
    for (const p of added) {
      outcomes.push(
        await keepOrSend(dispatch, getState, { userId, tripId, memoryId: id, entryId: `photo-${p.photoId}`, op: "addPhoto", body: p })
      );
    }
    await refreshPendingCount(dispatch, getState);
    if (outcomes.includes("lost")) {
      dispatch(notify({ type: "error", message: NOT_KEPT }));
      return;
    }
    dispatch(notify({ type: "success", message: "Memory updated" }));
    dispatch(syncOutbox());
  };

export const deleteMemory =
  ({ tripId, id }) =>
  async (dispatch, getState) => {
    dispatch(localWrite({ tripId, op: "delete", memory: { id } }));
    await keepOrSend(dispatch, getState, { userId: userOf(getState), tripId, memoryId: id, op: "delete", body: {} });
    await refreshPendingCount(dispatch, getState);
    dispatch(notify({ type: "success", message: "Memory deleted" }));
    dispatch(syncOutbox());
  };

const journalSlice = createSlice({
  name: "journal",
  initialState: {
    tripId: null,
    items: [],
    status: "idle",
    stale: false,
    pendingCount: 0, // memory writes waiting (they go automatically)
    waitingPhotos: { count: 0, bytes: 0 }, // photos waiting for Upload
    stuckCount: 0, // writes the server refused, kept until sent again or removed
    upload: null, // { done, total } while uploading
  },
  reducers: {
    memoriesLoaded(state, action) {
      if (state.tripId !== action.payload.tripId) return;
      state.items = action.payload.items;
    },
    localWrite(state, action) {
      const { tripId, op, memory } = action.payload;
      if (state.tripId !== tripId) return;
      if (op === "create") {
        state.items = sortMemories([...state.items, memory]);
      } else if (op === "update") {
        const i = state.items.findIndex((m) => m.id === memory.id);
        if (i !== -1) state.items[i] = { ...state.items[i], ...memory, pending: true };
      } else {
        state.items = state.items.filter((m) => m.id !== memory.id);
      }
    },
    synced(state, action) {
      const { op, data } = action.payload;
      if (state.tripId !== op.tripId) return;
      const i = state.items.findIndex((m) => m.id === op.memoryId);
      if (i === -1) return;
      const local = state.items[i];
      if (op.op === "addPhoto" && data) {
        // The uploaded photo replaces the phone's own copy, in place.
        local.photos = (local.photos ?? []).map((p) => (p.id === data.id ? data : p));
        return;
      }
      if (op.op === "removePhoto") {
        local.photos = (local.photos ?? []).filter((p) => p.id !== op.body.photoId);
        return;
      }
      if (isPhotoOp(op) || !data) return;
      // The server's copy (it may have clamped the time), back in order.
      // Photos: on an edit the phone's list is the truth (a removal queued
      // after this update hasn't reached the server yet); on a create, keep
      // the ones still uploading.
      const photos =
        op.op === "update"
          ? (local.photos ?? [])
          : [...(data.photos ?? []), ...(local.photos ?? []).filter((p) => p.pending)];
      const merged = { ...data, photos };
      state.items = sortMemories(state.items.map((m) => (m.id === op.memoryId ? merged : m)));
    },
    // The server refused a write: it stays on screen, marked (never removed).
    syncFailed(state, action) {
      const { op, stuck } = action.payload;
      if (state.tripId !== op.tripId) return;
      const memory = state.items.find((m) => m.id === op.memoryId);
      if (!memory) return;
      if (op.op === "create" || op.op === "update") {
        memory.stuck = stuck;
      } else if (op.op === "addPhoto") {
        const photo = (memory.photos ?? []).find((p) => p.id === op.body.photoId);
        if (photo) photo.stuck = stuck;
      }
    },
    // Back in line to be sent: these entry ids (a memory id, "photo-<id>"), or all.
    stuckCleared(state, action) {
      const ids = action.payload;
      for (const memory of state.items) {
        if (memory.stuck && (!ids || ids.includes(memory.id))) delete memory.stuck;
        for (const photo of memory.photos ?? []) {
          if (photo.stuck && (!ids || ids.includes(`photo-${photo.id}`))) delete photo.stuck;
        }
      }
    },
    // A stuck write given up on: a new photo or memory goes; an edit falls
    // back to the server's copy on the next load.
    stuckRemoved(state, action) {
      const { tripId, entryId } = action.payload;
      if (state.tripId !== tripId) return;
      if (entryId.startsWith("photo-")) {
        const photoId = entryId.slice("photo-".length);
        for (const memory of state.items) {
          memory.photos = (memory.photos ?? []).filter((p) => p.id !== photoId);
        }
        return;
      }
      const memory = state.items.find((m) => m.id === entryId);
      if (!memory) return;
      if (!memory.receivedAt) state.items = state.items.filter((m) => m.id !== entryId);
      else delete memory.stuck;
    },
    // Neither kept on the phone nor sent: it exists only on screen.
    notSaved(state, action) {
      const { tripId, memoryId, photoId } = action.payload;
      if (state.tripId !== tripId) return;
      const memory = state.items.find((m) => m.id === memoryId);
      if (!memory) return;
      if (!photoId) memory.unsaved = true;
      else {
        const photo = (memory.photos ?? []).find((p) => p.id === photoId);
        if (photo) photo.unsaved = true;
      }
    },
    pendingCountChanged(state, action) {
      const { memories, photos, photoBytes, stuck = 0 } = action.payload;
      state.pendingCount = memories;
      state.waitingPhotos = { count: photos, bytes: photoBytes };
      state.stuckCount = stuck;
    },
    uploadProgress(state, action) {
      state.upload = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMemories.pending, (state, action) => {
        if (state.tripId !== action.meta.arg) {
          state.items = [];
          state.stale = false;
        }
        state.tripId = action.meta.arg;
        state.status = "loading";
      })
      .addCase(fetchMemories.fulfilled, (state, action) => {
        if (state.tripId !== action.meta.arg) return;
        state.items = action.payload;
        state.status = "idle";
        state.stale = false;
      })
      .addCase(fetchMemories.rejected, (state, action) => {
        if (state.tripId !== action.meta.arg) return;
        state.status = action.payload === "offline" ? "idle" : "failed";
        state.stale = action.payload === "offline";
      });
  },
});

const {
  memoriesLoaded,
  localWrite,
  synced,
  syncFailed,
  stuckCleared,
  stuckRemoved,
  notSaved,
  pendingCountChanged,
  uploadProgress,
} = journalSlice.actions;
export default journalSlice.reducer;

/** How many of your memory writes haven't reached the server yet (photos not counted). */
export function selectPendingMemories(state) {
  return state.journal?.pendingCount ?? 0;
}

const NO_PHOTOS = { count: 0, bytes: 0 };
/** Photos waiting on this phone for Upload: { count, bytes }. */
export function selectWaitingPhotos(state) {
  return state.journal?.waitingPhotos ?? NO_PHOTOS;
}

/** Writes the server refused, kept on this phone until sent again or removed. */
export function selectStuckCount(state) {
  return state.journal?.stuckCount ?? 0;
}

/** { done, total } while photos are uploading, else null. */
export function selectUpload(state) {
  return state.journal?.upload ?? null;
}
