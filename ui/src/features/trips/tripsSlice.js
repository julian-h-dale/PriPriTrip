import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { notify } from "@/shared/notificationSlice";

export const fetchTrips = createAsyncThunk("trips/fetch", async () => {
  const { data } = await apiClient.get("/trips", { silent: true });
  return data;
});

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

export const deleteTrip = createAsyncThunk("trips/delete", async (id, { dispatch }) => {
  await apiClient.delete(`/trips/${id}`, { silent: true });
  dispatch(notify({ type: "success", message: "Trip deleted" }));
  return id;
});

const tripsSlice = createSlice({
  name: "trips",
  initialState: { items: [], status: "idle" },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTrips.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchTrips.fulfilled, (state, action) => {
        state.status = "idle";
        state.items = action.payload;
      })
      .addCase(fetchTrips.rejected, (state) => {
        state.status = "failed";
      })
      .addCase(importTrip.fulfilled, (state, action) => {
        state.items.push(action.payload);
        state.items.sort((a, b) => a.startDate.localeCompare(b.startDate));
      })
      .addCase(deleteTrip.fulfilled, (state, action) => {
        state.items = state.items.filter((t) => t.id !== action.payload);
      });
  },
});

export default tripsSlice.reducer;
