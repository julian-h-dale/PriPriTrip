import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";
import { readTripList, removeTrip, saveMemories, saveTrip, saveTripList } from "@/shared/services/tripCache";
import { userIdFromToken } from "@/shared/utils/authToken";
import { tripPhase } from "@/shared/utils/tripDates";

/**
 * Keep the phone's copy of every trip that hasn't ended fresh, so they open
 * offline without having been opened first. Fire-and-forget, one at a time
 * (a handful of small requests); a failure just leaves the older copy.
 */
async function cacheUnfinishedTrips(userId, summaries) {
  for (const summary of summaries) {
    if (tripPhase(summary) === "past") continue;
    try {
      const { data } = await apiClient.get(`/trips/${summary.id}`, { silent: true, offlineOk: true });
      await saveTrip(userId, data);
    } catch {
      return; // offline or server gone — stop, don't hammer it
    }
  }
}

/**
 * Before "Use saved copies only" goes on (Run stage 20): save the trips list
 * and every trip that hasn't ended, with its journal, while there's still a
 * connection. One at a time; the first failure stops it (offline), keeping
 * whatever was saved.
 */
export async function saveTripsForOffline(dispatch, getState) {
  const userId = userIdFromToken(getState().auth.token);
  if (!userId) return;
  const { data: list } = await apiClient.get("/trips", { silent: true, offlineOk: true });
  await saveTripList(userId, list);
  for (const summary of list) {
    if (tripPhase(summary) === "past") continue;
    const { data: trip } = await apiClient.get(`/trips/${summary.id}`, { silent: true, offlineOk: true });
    await saveTrip(userId, trip);
    const { data: memories } = await apiClient.get(`/trips/${summary.id}/memories`, { silent: true, offlineOk: true });
    await saveMemories(userId, summary.id, memories);
  }
}

/**
 * Stale-while-revalidate: the cached list (if any) renders straight away,
 * then the server's copy replaces it. With no network the cached copy stays,
 * marked stale with when it was saved.
 */
export const fetchTrips = createAsyncThunk(
  "trips/fetch",
  async (_, { dispatch, getState, rejectWithValue }) => {
    const userId = userIdFromToken(getState().auth.token);
    const cached = await readTripList(userId);
    if (cached) dispatch(tripsFromCache(cached));
    try {
      const { data } = await apiClient.get("/trips", { silent: true, offlineOk: true });
      if (userId) {
        await saveTripList(userId, data);
        cacheUnfinishedTrips(userId, data);
      }
      return data;
    } catch (err) {
      return rejectWithValue({ offline: !err.response, cached: Boolean(cached) });
    }
  }
);

/**
 * Upload a trip document. Always creates a new trip. On a rejected document
 * the payload is `{ detail, errors: [{ path, message }] }` so the dialog can
 * list every problem.
 */
export const importTrip = createAsyncThunk(
  "trips/import",
  async (file, { dispatch, rejectWithValue }) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await apiClient.post("/trips/import", form, { silent: true });
      dispatch(notify({ type: "success", message: `Imported “${data.name}”` }));
      return data;
    } catch (err) {
      const body = err.response?.data;
      return rejectWithValue({
        detail: typeof body?.detail === "string" ? body.detail : "Import failed",
        errors: Array.isArray(body?.errors) ? body.errors : [],
      });
    }
  }
);

/** Stop viewing a trip someone shared with you. */
export const leaveTrip = createAsyncThunk("trips/leave", async (id, { dispatch, getState }) => {
  await apiClient.delete(`/trips/${id}/membership`, { silent: true });
  await removeTrip(userIdFromToken(getState().auth.token), id);
  dispatch(notify({ type: "success", message: "Left the trip" }));
  return id;
});

export const deleteTrip = createAsyncThunk("trips/delete", async (id, { dispatch, getState }) => {
  await apiClient.delete(`/trips/${id}`, { silent: true });
  await removeTrip(userIdFromToken(getState().auth.token), id);
  dispatch(notify({ type: "success", message: "Trip deleted" }));
  return id;
});

const tripsSlice = createSlice({
  name: "trips",
  // stale: showing the offline copy saved at `savedAt` because the server
  // couldn't be reached.
  initialState: { items: [], status: "idle", stale: false, savedAt: null },
  reducers: {
    tripsFromCache(state, action) {
      state.items = action.payload.data;
      state.savedAt = action.payload.savedAt;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTrips.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchTrips.fulfilled, (state, action) => {
        state.status = "idle";
        state.items = action.payload;
        state.stale = false;
        state.savedAt = new Date().toISOString(); // just saved on the phone
      })
      .addCase(fetchTrips.rejected, (state, action) => {
        const { offline, cached } = action.payload ?? {};
        if (offline && cached) {
          state.status = "idle";
          state.stale = true;
        } else {
          state.status = "failed";
        }
      })
      .addCase(importTrip.fulfilled, (state, action) => {
        state.items.push(action.payload);
        state.items.sort((a, b) => a.startDate.localeCompare(b.startDate));
      })
      .addCase(leaveTrip.fulfilled, (state, action) => {
        state.items = state.items.filter((t) => t.id !== action.payload);
      })
      .addCase(deleteTrip.fulfilled, (state, action) => {
        state.items = state.items.filter((t) => t.id !== action.payload);
      });
  },
});

const { tripsFromCache } = tripsSlice.actions;
export default tripsSlice.reducer;
