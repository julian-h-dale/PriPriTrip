import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { deviceZone } from "@/features/journal/journalDays";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";
import { applyPending, done, enqueue, pending, pendingPhoto, sortMemories } from "@/shared/services/outbox";
import { readMemories, saveMemories } from "@/shared/services/tripCache";
import { userIdFromToken } from "@/shared/utils/authToken";

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

/** Recount what's waiting: memory writes (sent automatically) and photos (sent on Upload). */
async function refreshPendingCount(dispatch, getState) {
  const ops = await pending(userOf(getState));
  const photos = ops.filter((op) => op.op === "addPhoto");
  dispatch(
    pendingCountChanged({
      memories: ops.length - photos.length,
      photos: photos.length,
      photoBytes: photos.reduce((n, op) => n + (op.body.file?.bytes?.byteLength ?? 0), 0),
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
      },
      quiet
    ),
  // `location: null` only when the edit removed it; otherwise it's left out (kept).
  update: (op) =>
    apiClient.put(
      `/trips/${op.tripId}/memories/${op.memoryId}`,
      "location" in op.body ? { text: op.body.text, location: null } : { text: op.body.text },
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

/** An outbox entry fit for a Redux action: a photo's bytes stay out of the store. */
const forAction = (op) => (isPhotoOp(op) ? { ...op, body: { photoId: op.body.photoId } } : op);

let syncing = null;

/**
 * Send the outbox, oldest first. Photos wait on the phone until the user
 * taps Upload (`{ photos: true }`, see `uploadPhotos`): a web app can't tell
 * Wi-Fi from cellular, so they choose when. Everything else — memories,
 * edits, deletes, photo removals — goes whenever this runs.
 *
 * Stops at the first network failure or server error (try again later) or a
 * 401 (signed out; the outbox is kept for after signing in). A write the
 * server rejects for good — 404 (no longer on the trip), 409, 422 — is
 * dropped with a toast, since retrying can't help. One sync runs at a time;
 * a request during one runs again after it.
 */
export const syncOutbox =
  ({ photos = false } = {}) =>
  (dispatch, getState) => {
    // Asked again mid-sync (e.g. the connection just came back while an
    // offline pass was finishing): run once more right after, never drop it.
    if (syncing) return syncing.then(() => dispatch(syncOutbox({ photos })));
    syncing = (async () => {
      try {
        const userId = userOf(getState);
        const ops = (await pending(userId)).filter((op) => photos || op.op !== "addPhoto");
        const uploads = ops.filter((op) => op.op === "addPhoto").length;
        if (uploads) dispatch(uploadProgress({ done: 0, total: uploads }));
        let uploaded = 0;
        for (const op of ops) {
          if (getState().network?.online === false) break;
          try {
            const { data } = await SEND[op.op](op);
            await done(userId, op.entryId ?? op.memoryId);
            dispatch(synced({ op: forAction(op), data: data ?? null }));
            if (op.op === "addPhoto") dispatch(uploadProgress({ done: ++uploaded, total: uploads }));
          } catch (err) {
            const status = err.response?.status;
            if (!status || status === 401 || status >= 500) break; // try again later
            await done(userId, op.entryId ?? op.memoryId);
            dispatch(syncFailed({ op: forAction(op) }));
            dispatch(
              notify({
                type: "error",
                message: isPhotoOp(op)
                  ? "A photo couldn’t be uploaded and was dropped."
                  : "A memory couldn’t be saved and was dropped.",
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

/** Upload the photos waiting on this phone (and anything else queued), then say how it went. */
export const uploadPhotos = () => async (dispatch, getState) => {
  await dispatch(syncOutbox({ photos: true }));
  const left = getState().journal.waitingPhotos.count;
  dispatch(
    left === 0
      ? notify({ type: "success", message: "Photos uploaded" })
      : notify({
          type: "error",
          message: `Upload stopped: ${left} ${left === 1 ? "photo is" : "photos are"} still on this phone. Tap Upload to carry on.`,
        })
  );
};

const isOnline = (getState) => getState().network?.online !== false;

/**
 * Write a new memory: on screen now, sent when there's a connection.
 * `location` ({ lat, lng, accuracy } or null) is where the phone was.
 */
export const createMemory =
  ({ tripId, text, location = null, files = [] }) =>
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
      photos: photos.map((p) => pendingPhoto(p.photoId, p.file)),
      authorEmail: getState().auth?.user?.email ?? "",
      mine: true,
      pending: true,
    };
    dispatch(localWrite({ tripId, op: "create", memory }));
    await enqueue({
      userId: userOf(getState),
      tripId,
      memoryId: memory.id,
      op: "create",
      body: { text, zone: memory.zone, createdAt: memory.createdAt, location },
    });
    // Queued after the memory, so they're sent after it exists.
    for (const p of photos) {
      await enqueue({
        userId: userOf(getState),
        tripId,
        memoryId: memory.id,
        entryId: `photo-${p.photoId}`,
        op: "addPhoto",
        body: p,
      });
    }
    await refreshPendingCount(dispatch, getState);
    dispatch(
      notify({
        type: "success",
        message: isOnline(getState) ? "Memory saved" : "Saved on this phone — it’ll sync when you’re online",
      })
    );
    dispatch(syncOutbox());
    return memory;
  };

/**
 * Change your memory's words (and optionally drop its location); its time
 * and place in the journal stay. A location is never added on an edit.
 */
export const updateMemory =
  ({ tripId, id, text, clearLocation = false, addFiles = [], removePhotoIds = [] }) =>
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
      ...(clearLocation ? { location: null } : {}),
    };
    dispatch(localWrite({ tripId, op: "update", memory: changes }));
    await enqueue({
      userId: userOf(getState),
      tripId,
      memoryId: id,
      op: "update",
      body: clearLocation ? { text, location: null } : { text },
    });
    for (const photoId of removePhotoIds) {
      await enqueue({ userId: userOf(getState), tripId, memoryId: id, entryId: `photo-${photoId}`, op: "removePhoto", body: { photoId } });
    }
    for (const p of added) {
      await enqueue({ userId: userOf(getState), tripId, memoryId: id, entryId: `photo-${p.photoId}`, op: "addPhoto", body: p });
    }
    await refreshPendingCount(dispatch, getState);
    dispatch(notify({ type: "success", message: "Memory updated" }));
    dispatch(syncOutbox());
  };

export const deleteMemory =
  ({ tripId, id }) =>
  async (dispatch, getState) => {
    dispatch(localWrite({ tripId, op: "delete", memory: { id } }));
    await enqueue({ userId: userOf(getState), tripId, memoryId: id, op: "delete", body: {} });
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
    syncFailed(state, action) {
      const { op } = action.payload;
      if (state.tripId !== op.tripId) return;
      if (op.op === "create") {
        state.items = state.items.filter((m) => m.id !== op.memoryId);
      } else if (op.op === "addPhoto") {
        const memory = state.items.find((m) => m.id === op.memoryId);
        if (memory) memory.photos = (memory.photos ?? []).filter((p) => p.id !== op.body.photoId);
      }
    },
    pendingCountChanged(state, action) {
      const { memories, photos, photoBytes } = action.payload;
      state.pendingCount = memories;
      state.waitingPhotos = { count: photos, bytes: photoBytes };
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

const { memoriesLoaded, localWrite, synced, syncFailed, pendingCountChanged, uploadProgress } =
  journalSlice.actions;
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

/** { done, total } while photos are uploading, else null. */
export function selectUpload(state) {
  return state.journal?.upload ?? null;
}
