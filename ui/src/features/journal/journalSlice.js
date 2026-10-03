import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { deviceZone } from "@/features/journal/journalDays";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";
import { applyPending, done, enqueue, pending, sortMemories } from "@/shared/services/outbox";
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

/** Save the offline copy: what the server has confirmed (pending writes live in the outbox). */
async function persist(getState) {
  const { tripId, items } = getState().journal;
  if (tripId) await saveMemories(userOf(getState), tripId, items.filter((m) => !m.pending));
}

async function refreshPendingCount(dispatch, getState) {
  dispatch(pendingCountChanged((await pending(userOf(getState))).length));
}

export const fetchMemories = createAsyncThunk(
  "journal/fetch",
  async (tripId, { dispatch, getState, rejectWithValue }) => {
    const userId = userOf(getState);
    const cached = await readMemories(userId, tripId);
    if (cached) {
      dispatch(memoriesLoaded({ tripId, items: applyPending(cached.data, await pending(userId), tripId) }));
    }
    try {
      const { data } = await apiClient.get(`/trips/${tripId}/memories`, { silent: true, offlineOk: true });
      await saveMemories(userId, tripId, data);
      return applyPending(data, await pending(userId), tripId);
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
      { id: op.memoryId, createdAt: op.body.createdAt, text: op.body.text, zone: op.body.zone },
      quiet
    ),
  update: (op) => apiClient.put(`/trips/${op.tripId}/memories/${op.memoryId}`, { text: op.body.text }, quiet),
  delete: (op) => apiClient.delete(`/trips/${op.tripId}/memories/${op.memoryId}`, quiet),
};

let syncing = null;

/**
 * Send everything in the outbox, oldest first. Stops at the first network
 * failure or server error (try again later) or a 401 (signed out; the outbox
 * is kept for after signing in). A write the server rejects for good — 404
 * (no longer on the trip), 409, 422 — is dropped with a toast, since
 * retrying can't help. One sync runs at a time; a request during one runs
 * again after it.
 */
export const syncOutbox = () => (dispatch, getState) => {
  // Asked again mid-sync (e.g. the connection just came back while an
  // offline pass was finishing): run once more right after, never drop it.
  if (syncing) return syncing.then(() => dispatch(syncOutbox()));
  syncing = (async () => {
    try {
      const userId = userOf(getState);
      for (const op of await pending(userId)) {
        if (getState().network?.online === false) break;
        try {
          const { data } = await SEND[op.op](op);
          await done(userId, op.memoryId);
          dispatch(synced({ op, memory: data ?? null }));
        } catch (err) {
          const status = err.response?.status;
          if (!status || status === 401 || status >= 500) break; // try again later
          await done(userId, op.memoryId);
          dispatch(syncFailed({ op }));
          dispatch(notify({ type: "error", message: "A memory couldn’t be saved and was dropped." }));
        }
      }
      await persist(getState);
      await refreshPendingCount(dispatch, getState);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
};

const isOnline = (getState) => getState().network?.online !== false;

/** Write a new memory: on screen now, sent when there's a connection. */
export const createMemory =
  ({ tripId, text }) =>
  async (dispatch, getState) => {
    const memory = {
      id: crypto.randomUUID(),
      text,
      zone: deviceZone(),
      createdAt: new Date().toISOString(), // the moment Save was tapped
      updatedAt: null,
      receivedAt: null,
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
      body: { text, zone: memory.zone, createdAt: memory.createdAt },
    });
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

/** Change your memory's words; its time and place in the journal stay. */
export const updateMemory =
  ({ tripId, id, text }) =>
  async (dispatch, getState) => {
    dispatch(localWrite({ tripId, op: "update", memory: { id, text, updatedAt: new Date().toISOString() } }));
    await enqueue({ userId: userOf(getState), tripId, memoryId: id, op: "update", body: { text } });
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
  initialState: { tripId: null, items: [], status: "idle", stale: false, pendingCount: 0 },
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
      const { op, memory } = action.payload;
      if (state.tripId !== op.tripId || !memory) return;
      // The server's copy (it may have clamped the time), back in order.
      if (state.items.some((m) => m.id === op.memoryId)) {
        state.items = sortMemories(state.items.map((m) => (m.id === op.memoryId ? memory : m)));
      }
    },
    syncFailed(state, action) {
      const { op } = action.payload;
      if (state.tripId === op.tripId && op.op === "create") {
        state.items = state.items.filter((m) => m.id !== op.memoryId);
      }
    },
    pendingCountChanged(state, action) {
      state.pendingCount = action.payload;
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

const { memoriesLoaded, localWrite, synced, syncFailed, pendingCountChanged } = journalSlice.actions;
export default journalSlice.reducer;

/** How many of your memories haven't reached the server yet. */
export function selectPendingMemories(state) {
  return state.journal?.pendingCount ?? 0;
}
