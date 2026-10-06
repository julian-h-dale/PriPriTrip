import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { readWeather, saveWeather } from "@/shared/services/tripCache";
import { userIdFromToken } from "@/shared/utils/authToken";

/**
 * A trip's weather (GET /trips/:id/weather): the server caches
 * OpenWeatherMap for 12 hours; this keeps the last answer on the phone too,
 * so the page shows it at once and offline ("Updated 3 hours ago").
 */
export const fetchWeather = createAsyncThunk(
  "weather/fetch",
  async (tripId, { dispatch, getState, rejectWithValue }) => {
    const userId = userIdFromToken(getState().auth?.token);
    const cached = await readWeather(userId, tripId);
    if (cached) dispatch(weatherFromCache({ tripId, ...cached }));
    try {
      const { data } = await apiClient.get(`/trips/${tripId}/weather`, { silent: true, offlineOk: true });
      await saveWeather(userId, tripId, data);
      return { tripId, data, savedAt: new Date().toISOString() };
    } catch {
      return rejectWithValue({ tripId, cached: Boolean(cached) });
    }
  }
);

const weatherSlice = createSlice({
  name: "weather",
  initialState: { tripId: null, data: null, savedAt: null, status: "idle", stale: false },
  reducers: {
    weatherFromCache(state, action) {
      const { tripId, data, savedAt } = action.payload;
      if (state.tripId !== tripId) return;
      state.data = data;
      state.savedAt = savedAt;
      state.stale = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWeather.pending, (state, action) => {
        if (state.tripId !== action.meta.arg) {
          state.tripId = action.meta.arg;
          state.data = null;
          state.savedAt = null;
        }
        state.status = "loading";
      })
      .addCase(fetchWeather.fulfilled, (state, action) => {
        if (state.tripId !== action.payload.tripId) return;
        state.data = action.payload.data;
        state.savedAt = action.payload.savedAt;
        state.status = "ready";
        state.stale = false;
      })
      .addCase(fetchWeather.rejected, (state, action) => {
        if (state.tripId !== action.meta.arg) return;
        state.status = "failed";
      });
  },
});

export const { weatherFromCache } = weatherSlice.actions;
export default weatherSlice.reducer;
