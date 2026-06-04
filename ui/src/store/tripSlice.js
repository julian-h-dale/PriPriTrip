import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import client from '../api/client';
import { cacheTrip, getCachedTrip } from '../utils/tripCache';

export const fetchTrips = createAsyncThunk('trip/fetchAll', async () => {
  const { data } = await client.get('/trips');
  return data;
});

export const fetchTrip = createAsyncThunk('trip/fetch', async (tripId) => {
  try {
    const { data } = await client.get(`/trips/${tripId}`);
    await cacheTrip(data).catch(() => {});
    return data;
  } catch {
    const cached = await getCachedTrip();
    if (cached && cached.tripId === tripId) return cached;
    throw new Error('No network and no cached trip available.');
  }
});

const tripSlice = createSlice({
  name: 'trip',
  initialState: {
    trips: [],
    tripsStatus: 'idle',
    data: null,
    status: 'idle',
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
      .addCase(fetchTrips.pending, (state) => {
        state.tripsStatus = 'loading';
      })
      .addCase(fetchTrips.fulfilled, (state, action) => {
        state.trips = action.payload;
        state.tripsStatus = 'idle';
      })
      .addCase(fetchTrips.rejected, (state) => {
        state.tripsStatus = 'error';
      })
      .addCase(fetchTrip.pending, (state) => {
        state.status = 'loading';
        state.error = null;
        state.data = null;
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

export const selectTrips = (state) => state.trip.trips;
export const selectTripsStatus = (state) => state.trip.tripsStatus;
export const selectTrip = (state) => state.trip.data;
export const selectTripStatus = (state) => state.trip.status;
export const selectTripError = (state) => state.trip.error;

export default tripSlice.reducer;
