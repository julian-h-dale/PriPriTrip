import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import client from '../api/client';
import { cacheTrip, getCachedTrip } from '../utils/tripCache';

export const fetchTrip = createAsyncThunk('trip/fetch', async () => {
  try {
    const { data } = await client.get('/trip');
    await cacheTrip(data).catch(() => {});
    return data;
  } catch {
    const cached = await getCachedTrip();
    if (cached) return cached;
    throw new Error('No network and no cached trip available.');
  }
});

const tripSlice = createSlice({
  name: 'trip',
  initialState: {
    data: null,
    status: 'idle', // 'idle' | 'loading' | 'error'
    error: null,
  },
  reducers: {
    setTrip(state, action) {
      state.data = action.payload;
      state.status = 'idle';
      state.error = null;
    },
    clearError(state) {
      state.error = null;
      if (state.status === 'error') state.status = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTrip.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchTrip.fulfilled, (state, action) => {
        state.data = action.payload;
        state.status = 'idle';
      })
      .addCase(fetchTrip.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.error.message ?? 'Failed to load trip';
      });
  },
});

export const { setTrip, clearError } = tripSlice.actions;

export const selectTrip = (state) => state.trip.data;
export const selectTripStatus = (state) => state.trip.status;
export const selectTripError = (state) => state.trip.error;

export default tripSlice.reducer;
