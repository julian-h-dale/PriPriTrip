import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import client from '../api/client';
import { cacheTrip, getCachedTrip } from '../utils/tripCache';

export const fetchTrip = createAsyncThunk('trip/fetch', async () => {
  try {
    const { data } = await client.get('/api/trip');
    // Persist to IndexedDB so the trip is available offline next time
    await cacheTrip(data).catch(() => {});
    return data;
  } catch {
    // Network failed — try to serve the last cached version
    const cached = await getCachedTrip();
    if (cached) return cached;
    throw new Error('No network and no cached trip available.');
  }
});

export const saveTrip = createAsyncThunk('trip/save', async (_, { getState }) => {
  if (!navigator.onLine) {
    throw new Error('You are offline. Connect to the internet to save.');
  }
  const trip = getState().trip.data;
  await client.put('/api/trip', trip);
  // Keep the cache in sync after a successful save
  await cacheTrip(trip).catch(() => {});
});

const tripSlice = createSlice({
  name: 'trip',
  initialState: {
    data: null,
    status: 'idle', // 'idle' | 'loading' | 'saving' | 'error'
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
    upsertItem(state, action) {
      if (!state.data) return;
      const item = action.payload;
      const idx = state.data.items.findIndex((i) => i.itemId === item.itemId);
      if (idx >= 0) {
        state.data.items[idx] = item;
      } else {
        state.data.items.push(item);
      }
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
      })
      .addCase(saveTrip.pending, (state) => {
        state.status = 'saving';
        state.error = null;
      })
      .addCase(saveTrip.fulfilled, (state) => {
        state.status = 'idle';
      })
      .addCase(saveTrip.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.error.message ?? 'Failed to save trip';
      });
  },
});

export const { setTrip, clearError, upsertItem } = tripSlice.actions;

export const selectTrip = (state) => state.trip.data;
export const selectTripStatus = (state) => state.trip.status;
export const selectTripError = (state) => state.trip.error;

export default tripSlice.reducer;
