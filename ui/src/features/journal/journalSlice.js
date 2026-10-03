import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { deviceZone } from "@/features/journal/journalDays";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";
import { readMemories, saveMemories } from "@/shared/services/tripCache";
import { userIdFromToken } from "@/shared/utils/authToken";

/**
 * One trip's journal. Reads are stale-while-revalidate like the trip itself
 * (the phone's saved copy first, then the server's). Writes need a
 * connection — offline capture comes later — and keep the saved copy in step.
 * The server's order (UTC creation time) is the order everywhere.
 */

const userOf = (getState) => userIdFromToken(getState().auth?.token);

export const fetchMemories = createAsyncThunk(
  "journal/fetch",
  async (tripId, { dispatch, getState, rejectWithValue }) => {
    const userId = userOf(getState);
    const cached = await readMemories(userId, tripId);
    if (cached) dispatch(memoriesFromCache({ tripId, ...cached }));
    try {
      const { data } = await apiClient.get(`/trips/${tripId}/memories`, { silent: true, offlineOk: true });
      await saveMemories(userId, tripId, data);
      return data;
    } catch (err) {
      return rejectWithValue(!err.response && cached ? "offline" : "failed");
    }
  }
);

function write(type, request, message) {
  const thunk = createAsyncThunk(type, async (args, { dispatch, rejectWithValue }) => {
    try {
      const { data } = await request(args);
      if (message) dispatch(notify({ type: "success", message }));
      return data ?? null;
    } catch (err) {
      const detail = err.response?.data?.detail;
      return rejectWithValue(typeof detail === "string" ? detail : "Couldn’t save the memory");
    }
  });
  // Dispatching resolves after the reducers have run, so the offline copy is
  // saved from the list as it now is (not as it was before the write).
  const run = (args) => async (dispatch, getState) => {
    const result = await dispatch(thunk(args));
    const { tripId, items } = getState().journal;
    if (result.meta.requestStatus === "fulfilled" && tripId === args.tripId) {
      await saveMemories(userOf(getState), tripId, items);
    }
    return result;
  };
  run.fulfilled = thunk.fulfilled;
  return run;
}

/** A new memory, stamped by the server in UTC; the phone sends its zone. */
export const createMemory = write(
  "journal/create",
  ({ tripId, text }) =>
    apiClient.post(`/trips/${tripId}/memories`, { text, zone: deviceZone() }, { silent: true }),
  "Memory saved"
);

export const updateMemory = write(
  "journal/update",
  ({ tripId, id, text }) => apiClient.put(`/trips/${tripId}/memories/${id}`, { text }, { silent: true }),
  "Memory updated"
);

export const deleteMemory = write(
  "journal/delete",
  ({ tripId, id }) => apiClient.delete(`/trips/${tripId}/memories/${id}`, { silent: true }),
  "Memory deleted"
);

const journalSlice = createSlice({
  name: "journal",
  initialState: { tripId: null, items: [], status: "idle", stale: false },
  reducers: {
    memoriesFromCache(state, action) {
      if (state.tripId !== action.payload.tripId) return;
      state.items = action.payload.data;
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
      })
      .addCase(createMemory.fulfilled, (state, action) => {
        // Newest last: the server stamped it after everything already here.
        if (state.tripId === action.meta.arg.tripId) state.items.push(action.payload);
      })
      .addCase(updateMemory.fulfilled, (state, action) => {
        const i = state.items.findIndex((m) => m.id === action.payload.id);
        if (i !== -1) state.items[i] = action.payload; // same place: edits never reorder
      })
      .addCase(deleteMemory.fulfilled, (state, action) => {
        state.items = state.items.filter((m) => m.id !== action.meta.arg.id);
      });
  },
});

const { memoriesFromCache } = journalSlice.actions;
export default journalSlice.reducer;

/** Writing memories needs a connection (offline capture is deferred); viewers may write. */
export function selectCanWriteMemory(state) {
  return state.network?.online !== false;
}
