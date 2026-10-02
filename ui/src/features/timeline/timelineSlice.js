import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";

export const fetchTrip = createAsyncThunk("timeline/fetchTrip", async (tripId, { rejectWithValue }) => {
  try {
    const { data } = await apiClient.get(`/trips/${tripId}`, { silent: true });
    return data;
  } catch (err) {
    return rejectWithValue(err.response?.status === 404 ? "notFound" : "failed");
  }
});

/**
 * Edits all return the whole updated trip, which replaces the one in state —
 * so the timeline (markers included) recomputes from the server's truth.
 * A rejected edit resolves to `{ detail, errors: [{ path, message }] }` for
 * the form to show inline.
 */
function tripEdit(type, request, successMessage) {
  return createAsyncThunk(type, async (args, { dispatch, rejectWithValue }) => {
    try {
      const { data } = await request(args);
      if (successMessage) dispatch(notify({ type: "success", message: successMessage }));
      return data;
    } catch (err) {
      const body = err.response?.data;
      return rejectWithValue({
        detail: typeof body?.detail === "string" ? body.detail : "Couldn’t save",
        errors: Array.isArray(body?.errors) ? body.errors : [],
      });
    }
  });
}

const quiet = { silent: true };

export const createItem = tripEdit(
  "timeline/createItem",
  ({ tripId, item }) => apiClient.post(`/trips/${tripId}/items`, item, quiet),
  "Activity added"
);

export const replaceItem = tripEdit(
  "timeline/replaceItem",
  ({ tripId, itemId, item }) => apiClient.put(`/trips/${tripId}/items/${itemId}`, item, quiet),
  "Activity saved"
);

export const deleteItem = tripEdit(
  "timeline/deleteItem",
  ({ tripId, itemId }) => apiClient.delete(`/trips/${tripId}/items/${itemId}`, quiet),
  "Activity deleted"
);

// No toast: the list visibly reorders, and a toast per tap would be noise.
export const moveItem = tripEdit(
  "timeline/moveItem",
  ({ tripId, itemId, direction }) =>
    apiClient.post(`/trips/${tripId}/items/${itemId}/move`, { direction }, quiet),
  null
);

export const updateDay = tripEdit(
  "timeline/updateDay",
  ({ tripId, date, day }) => apiClient.put(`/trips/${tripId}/days/${date}`, day, quiet),
  "Day saved"
);

export const createStay = tripEdit(
  "timeline/createStay",
  ({ tripId, stay }) => apiClient.post(`/trips/${tripId}/stays`, stay, quiet),
  "Stay added"
);

export const replaceStay = tripEdit(
  "timeline/replaceStay",
  ({ tripId, stayId, stay }) => apiClient.put(`/trips/${tripId}/stays/${stayId}`, stay, quiet),
  "Stay saved"
);

export const deleteStay = tripEdit(
  "timeline/deleteStay",
  ({ tripId, stayId }) => apiClient.delete(`/trips/${tripId}/stays/${stayId}`, quiet),
  "Stay deleted"
);

export const createTravel = tripEdit(
  "timeline/createTravel",
  ({ tripId, travel }) => apiClient.post(`/trips/${tripId}/travels`, travel, quiet),
  "Travel added"
);

export const replaceTravel = tripEdit(
  "timeline/replaceTravel",
  ({ tripId, travelId, travel }) =>
    apiClient.put(`/trips/${tripId}/travels/${travelId}`, travel, quiet),
  "Travel saved"
);

export const deleteTravel = tripEdit(
  "timeline/deleteTravel",
  ({ tripId, travelId }) => apiClient.delete(`/trips/${tripId}/travels/${travelId}`, quiet),
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
  initialState: { tripId: null, trip: null, status: "idle" },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTrip.pending, (state, action) => {
        if (state.tripId !== action.meta.arg) state.trip = null;
        state.tripId = action.meta.arg;
        state.status = "loading";
      })
      .addCase(fetchTrip.fulfilled, (state, action) => {
        if (state.tripId !== action.meta.arg) return;
        state.trip = action.payload;
        state.status = "idle";
      })
      .addCase(fetchTrip.rejected, (state, action) => {
        if (state.tripId !== action.meta.arg) return;
        state.status = action.payload ?? "failed";
      });
    EDITS.forEach((edit) =>
      builder.addCase(edit.fulfilled, (state, action) => {
        if (state.tripId === action.payload.id) state.trip = action.payload;
      })
    );
  },
});

export default timelineSlice.reducer;
