import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";

export const fetchTrip = createAsyncThunk("timeline/fetchTrip", async (tripId, { rejectWithValue }) => {
  try {
    const { data } = await apiClient.get(`/trips/${tripId}`, { silent: true });
    return data;
  } catch (err) {
    return rejectWithValue(err.response?.status === 404 ? "notFound" : "failed");
  }
});

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
  },
});

export default timelineSlice.reducer;
