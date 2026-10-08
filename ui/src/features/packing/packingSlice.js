import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";
import { selectOnline } from "@/shared/networkSlice";
import { readPacking, savePacking } from "@/shared/services/tripCache";
import {
  applyChanges,
  changeSent,
  queueChange,
  queueListDelete,
  waitingChanges,
} from "@/shared/services/packingQueue";
import { userIdFromToken } from "@/shared/utils/authToken";

/**
 * Your own packing list for one trip (GET /trips/:id/packing), usable with
 * no connection (Run stage 21):
 * - The list is saved on the phone as it loads, and shows from there first
 *   (and only, offline or with "Use saved copies only" on).
 * - Every change (tick, add, edit, delete, a whole list) shows at once and
 *   goes into the packing queue (shared/services/packingQueue.js), then
 *   `syncPacking` sends it when there's a connection. Silent: no "Saved"
 *   toast for every tick.
 * - Suggestions come from the server: online only.
 */

const userOf = (getState) => userIdFromToken(getState().auth?.token);

/** How many changes are waiting, for the page's note. */
async function countWaiting(dispatch, getState, tripId) {
  dispatch(waitingCounted((await waitingChanges(userOf(getState), tripId)).length));
}

export const fetchPacking = createAsyncThunk("packing/fetch", async (tripId, { dispatch, getState, rejectWithValue }) => {
  const userId = userOf(getState);
  const cached = await readPacking(userId, tripId);
  if (cached) {
    const pending = await waitingChanges(userId, tripId);
    dispatch(packingLoaded({ tripId, items: applyChanges(cached.data, pending), savedAt: cached.savedAt }));
  }
  await countWaiting(dispatch, getState, tripId);
  try {
    const { data } = await apiClient.get(`/trips/${tripId}/packing`, { silent: true, offlineOk: true });
    await savePacking(userId, tripId, data);
    // Changes still waiting go on top of the server's list.
    return { tripId, items: applyChanges(data, await waitingChanges(userId, tripId)) };
  } catch {
    return rejectWithValue({ cached: Boolean(cached) });
  }
});

/** Make a change: on screen now, queued, and sent when it can go. */
function change(type, apply) {
  return createAsyncThunk(`packing/${type}`, async (arg, { dispatch, getState }) => {
    const userId = userOf(getState);
    const result = await apply(arg, userId, getState);
    await countWaiting(dispatch, getState, arg.tripId);
    dispatch(syncPacking());
    return result;
  });
}

export const addPackingItem = change("add", async ({ tripId, category, text, quantity = 1 }, userId) => {
  const id = crypto.randomUUID(); // the phone's own id, so a retried add is one line
  await queueChange({ userId, tripId, itemId: id, op: "create", body: { category, text, quantity } });
  return { id, category, text, quantity, checked: false, waiting: true };
});

/** `changes`: any of { text, quantity, checked, category }. */
export const updatePackingItem = change("update", async ({ tripId, id, changes }, userId) => {
  await queueChange({ userId, tripId, itemId: id, op: "update", body: changes });
  return { id, changes };
});

export const deletePackingItem = change("delete", async ({ tripId, id }, userId) => {
  await queueChange({ userId, tripId, itemId: id, op: "delete" });
  return id;
});

/** Delete one of your lists: every line on it. */
export const deletePackingList = change("deleteList", async ({ tripId, category }, userId, getState) => {
  const itemIds = getState()
    .packing.items.filter((i) => i.category === category)
    .map((i) => i.id);
  await queueListDelete({ userId, tripId, category, itemIds });
  return category;
});

/** Fill an empty list with the usual things: the server's, so online only. */
export const addPackingSuggestions = createAsyncThunk("packing/suggestions", async (tripId) => {
  const { data } = await apiClient.post(`/trips/${tripId}/packing/suggestions`, null, { silent: true });
  return { tripId, items: data };
});

const SEND = {
  create: async ({ tripId, itemId, body }) => {
    const { checked, ...fields } = body;
    await apiClient.post(`/trips/${tripId}/packing`, { id: itemId, ...fields }, { silent: true, offlineOk: true });
    // Ticked before it ever reached the server: the add, then the tick.
    if (checked) await apiClient.patch(`/trips/${tripId}/packing/${itemId}`, { checked }, { silent: true, offlineOk: true });
  },
  update: ({ tripId, itemId, body }) =>
    apiClient.patch(`/trips/${tripId}/packing/${itemId}`, body, { silent: true, offlineOk: true }),
  delete: ({ tripId, itemId }) =>
    apiClient.delete(`/trips/${tripId}/packing/${itemId}`, { silent: true, offlineOk: true, handles: [404] }),
  deleteList: ({ tripId, category }) =>
    apiClient.delete(`/trips/${tripId}/packing/lists/${category}`, { silent: true, offlineOk: true }),
};

let syncing = null;

/**
 * Send the waiting packing changes, oldest first, when the app may use the
 * network (online, and "Use saved copies only" off). Stops at the first
 * that can't go (no connection, a 5xx, signed out) to try again later. A
 * change the server refuses for good (a 404, 409 or 422: the line is gone,
 * say) is dropped with a toast, and the list is reloaded so it shows the
 * truth. One sync at a time; asked again mid-sync, it runs once more after.
 */
export const syncPacking = () => (dispatch, getState) => {
  if (syncing) return syncing.then(() => dispatch(syncPacking()));
  if (!selectOnline(getState())) return Promise.resolve();
  syncing = (async () => {
    const userId = userOf(getState);
    let dropped = false;
    let sent = false;
    try {
      for (const c of await waitingChanges(userId)) {
        if (!selectOnline(getState())) break;
        try {
          await SEND[c.op](c);
          sent = true;
        } catch (err) {
          const status = err.response?.status;
          if (!status || status === 401 || status >= 500) break; // try again later
          if (!(c.op === "delete" && status === 404)) dropped = true; // already gone: fine
        }
        await changeSent(c.key);
      }
    } finally {
      syncing = null;
    }
    const tripId = getState().packing?.tripId;
    if (dropped) dispatch(notify({ type: "error", message: "A packing change couldn’t be saved." }));
    if (tripId && (sent || dropped) && selectOnline(getState())) await dispatch(fetchPacking(tripId));
    else if (tripId) await countWaiting(dispatch, getState, tripId);
  })();
  return syncing;
};

const packingSlice = createSlice({
  name: "packing",
  initialState: { tripId: null, items: [], status: "idle", waiting: 0 },
  reducers: {
    packingLoaded(state, action) {
      if (state.tripId !== action.payload.tripId) return;
      state.items = action.payload.items;
      state.status = "ready";
    },
    waitingCounted(state, action) {
      state.waiting = action.payload;
    },
  },
  extraReducers: (builder) => {
    const replaceList = (state, action) => {
      if (state.tripId !== action.payload.tripId) return;
      state.items = action.payload.items;
      state.status = "ready";
    };
    const forThisTrip = (state, action) => state.tripId === action.meta.arg.tripId;
    builder
      .addCase(fetchPacking.pending, (state, action) => {
        if (state.tripId !== action.meta.arg) {
          state.tripId = action.meta.arg;
          state.items = [];
          state.status = "loading";
          state.waiting = 0;
        }
      })
      .addCase(fetchPacking.fulfilled, replaceList)
      .addCase(fetchPacking.rejected, (state, action) => {
        if (state.tripId === action.meta.arg && state.status === "loading") state.status = "failed";
      })
      .addCase(addPackingSuggestions.fulfilled, replaceList)
      // Each change shows at once (the queue sends it).
      .addCase(addPackingItem.fulfilled, (state, action) => {
        if (!forThisTrip(state, action)) return;
        const { category } = action.payload;
        const position = Math.max(-1, ...state.items.filter((i) => i.category === category).map((i) => i.position)) + 1;
        state.items.push({ ...action.payload, position });
      })
      .addCase(updatePackingItem.pending, (state, action) => {
        if (!forThisTrip(state, action)) return;
        const item = state.items.find((i) => i.id === action.meta.arg.id);
        if (item) Object.assign(item, action.meta.arg.changes, { waiting: true });
      })
      .addCase(deletePackingItem.pending, (state, action) => {
        if (forThisTrip(state, action)) state.items = state.items.filter((i) => i.id !== action.meta.arg.id);
      })
      .addCase(deletePackingList.fulfilled, (state, action) => {
        if (forThisTrip(state, action)) state.items = state.items.filter((i) => i.category !== action.payload);
      });
  },
});

export const { packingLoaded, waitingCounted } = packingSlice.actions;
export default packingSlice.reducer;
