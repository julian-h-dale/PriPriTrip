import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";
import { readTrip, removeTrip, saveTrip } from "@/shared/services/tripCache";
import { userIdFromToken } from "@/shared/utils/authToken";
import { formatAgo } from "@/shared/utils/time";

/**
 * Stale-while-revalidate, like the trips list: the phone's saved copy (if
 * any) renders at once, then the server's replaces it. With no network the
 * saved copy stays, marked stale. A real 404 still means gone, and drops the
 * saved copy too.
 */
export const fetchTrip = createAsyncThunk(
  "timeline/fetchTrip",
  async (tripId, { dispatch, getState, rejectWithValue }) => {
    const userId = userIdFromToken(getState().auth?.token);
    const cached = await readTrip(userId, tripId);
    if (cached) dispatch(tripFromCache({ tripId, ...cached }));
    try {
      const { data } = await apiClient.get(`/trips/${tripId}`, { silent: true, offlineOk: true });
      await saveTrip(userId, data);
      return data;
    } catch (err) {
      if (err.response?.status === 404) {
        await removeTrip(userId, tripId);
        return rejectWithValue("notFound");
      }
      return rejectWithValue(!err.response && cached ? "offline" : "failed");
    }
  }
);

/** What to say when someone else changed (409) or removed (404) an entry
 * while you were editing it. */
function conflictMessage(status, detail) {
  if (status === 404) return "That was removed by someone else. Showing the latest.";
  const who = detail?.updatedByName ?? "Someone else";
  const when = detail?.updatedAt ? ` ${formatAgo(detail.updatedAt)}` : "";
  return `${who} changed this${when}. Showing the latest.`;
}

const OUT_OF_DATE = "The app has been updated. Close and reopen it, then try again.";

/**
 * Edits all return the whole updated trip, which replaces the one in state —
 * so the timeline (markers included) recomputes from the server's truth.
 * A rejected edit resolves to `{ detail, errors: [{ path, message }] }` for
 * the form to show inline.
 *
 * Changing or deleting an entry sends the version it was read at (If-Match;
 * api/app/services/versions.py). If someone else got there first (409) or
 * removed it (404), there's nothing to merge: a warning says who, the trip
 * reloads, and the edit resolves to `{ reloaded: true }` so its form closes.
 * A 428 means this app is too old to send a version.
 */
function tripEdit(type, request, successMessage) {
  return createAsyncThunk(type, async (args, { dispatch, getState, rejectWithValue }) => {
    try {
      const { data } = await request(args);
      // Every edit returns the whole trip — keep the offline copy in step.
      await saveTrip(userIdFromToken(getState().auth?.token), data);
      if (successMessage) dispatch(notify({ type: "success", message: successMessage }));
      return data;
    } catch (err) {
      const status = err.response?.status;
      const body = err.response?.data;
      if (status === 409 || status === 404) {
        dispatch(notify({ type: "warning", message: conflictMessage(status, body?.detail) }));
        dispatch(fetchTrip(args.tripId));
        return rejectWithValue({ reloaded: true, detail: null, errors: [] });
      }
      if (status === 428) {
        dispatch(notify({ type: "error", message: OUT_OF_DATE }));
        return rejectWithValue({ detail: OUT_OF_DATE, errors: [] });
      }
      return rejectWithValue({
        detail: typeof body?.detail === "string" ? body.detail : "Couldn’t save",
        errors: Array.isArray(body?.errors) ? body.errors : [],
      });
    }
  });
}

// `handles`: tripEdit explains these itself, so no generic error toast.
const quiet = { silent: true, handles: [404, 409, 428] };

/** Request options for changing an entry read at `version`. */
function versioned(version) {
  return { ...quiet, headers: { "If-Match": `"${version}"` } };
}

export const createItem = tripEdit(
  "timeline/createItem",
  ({ tripId, item }) => apiClient.post(`/trips/${tripId}/items`, item, quiet),
  "Activity added"
);

export const replaceItem = tripEdit(
  "timeline/replaceItem",
  ({ tripId, itemId, item, version }) =>
    apiClient.put(`/trips/${tripId}/items/${itemId}`, item, versioned(version)),
  "Activity saved"
);

export const deleteItem = tripEdit(
  "timeline/deleteItem",
  ({ tripId, itemId, version }) =>
    apiClient.delete(`/trips/${tripId}/items/${itemId}`, versioned(version)),
  "Activity deleted"
);

// No toast: the list visibly reorders, and a toast per tap would be noise.
export const moveItem = tripEdit(
  "timeline/moveItem",
  ({ tripId, itemId, direction }) =>
    apiClient.post(`/trips/${tripId}/items/${itemId}/move`, { direction }, quiet),
  null
);

// `version`: the day row's, or 0 for a date that has no row yet.
export const updateDay = tripEdit(
  "timeline/updateDay",
  ({ tripId, date, day, version }) =>
    apiClient.put(`/trips/${tripId}/days/${date}`, day, versioned(version)),
  "Day saved"
);

export const createStay = tripEdit(
  "timeline/createStay",
  ({ tripId, stay }) => apiClient.post(`/trips/${tripId}/stays`, stay, quiet),
  "Stay added"
);

export const replaceStay = tripEdit(
  "timeline/replaceStay",
  ({ tripId, stayId, stay, version }) =>
    apiClient.put(`/trips/${tripId}/stays/${stayId}`, stay, versioned(version)),
  "Stay saved"
);

export const deleteStay = tripEdit(
  "timeline/deleteStay",
  ({ tripId, stayId, version }) =>
    apiClient.delete(`/trips/${tripId}/stays/${stayId}`, versioned(version)),
  "Stay deleted"
);

export const createTravel = tripEdit(
  "timeline/createTravel",
  ({ tripId, travel }) => apiClient.post(`/trips/${tripId}/travels`, travel, quiet),
  "Travel added"
);

export const replaceTravel = tripEdit(
  "timeline/replaceTravel",
  ({ tripId, travelId, travel, version }) =>
    apiClient.put(`/trips/${tripId}/travels/${travelId}`, travel, versioned(version)),
  "Travel saved"
);

export const deleteTravel = tripEdit(
  "timeline/deleteTravel",
  ({ tripId, travelId, version }) =>
    apiClient.delete(`/trips/${tripId}/travels/${travelId}`, versioned(version)),
  "Travel deleted"
);

const EDITS = [
  createItem,
  replaceItem,
  deleteItem,
  moveItem,
  updateDay,
  createStay,
  replaceStay,
  deleteStay,
  createTravel,
  replaceTravel,
  deleteTravel,
];

// `tripId` records which trip the state belongs to, so the page never shows
// the previous trip while the next one loads (a v1 bug).
const timelineSlice = createSlice({
  name: "timeline",
  // stale: showing the offline copy saved at `savedAt` because the server
  // couldn't be reached. Editing is off while it is (see selectReadOnly).
  initialState: { tripId: null, trip: null, status: "idle", stale: false, savedAt: null },
  reducers: {
    tripFromCache(state, action) {
      if (state.tripId !== action.payload.tripId) return;
      state.trip = action.payload.data;
      state.savedAt = action.payload.savedAt;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTrip.pending, (state, action) => {
        if (state.tripId !== action.meta.arg) {
          state.trip = null;
          state.stale = false;
          state.savedAt = null;
        }
        state.tripId = action.meta.arg;
        state.status = "loading";
      })
      .addCase(fetchTrip.fulfilled, (state, action) => {
        if (state.tripId !== action.meta.arg) return;
        state.trip = action.payload;
        state.status = "idle";
        state.stale = false;
        state.savedAt = null;
      })
      .addCase(fetchTrip.rejected, (state, action) => {
        if (state.tripId !== action.meta.arg) return;
        if (action.payload === "offline") {
          state.status = "idle";
          state.stale = true;
          return;
        }
        state.status = action.payload ?? "failed";
        // A trip that's really gone (404) mustn't linger from the cache.
        if (action.payload === "notFound") state.trip = null;
      });
    EDITS.forEach((edit) =>
      builder.addCase(edit.fulfilled, (state, action) => {
        if (state.tripId === action.payload.id) state.trip = action.payload;
      })
    );
  },
});

const { tripFromCache } = timelineSlice.actions;
export default timelineSlice.reducer;

/** The current trip was shared with you: you can read it, never edit it. */
export function selectIsViewer(state) {
  return state.timeline?.trip?.role === "viewer";
}

/**
 * Editing is off while offline or showing a saved copy (no write queue, so
 * nothing to lose or merge), and always for a viewer. Offline greys the
 * edit controls; a viewer doesn't get them at all (selectIsViewer).
 */
export function selectReadOnly(state) {
  return state.network?.online === false || Boolean(state.timeline?.stale) || selectIsViewer(state);
}
