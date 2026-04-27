import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import client from '../api/client';

export const fetchTrip = createAsyncThunk('trip/fetch', async () => {
  const { data } = await client.get('/api/trip');
  return data;
});

export const saveTrip = createAsyncThunk('trip/save', async (_, { getState }) => {
  const trip = getState().trip.data;
  await client.put('/api/trip', trip);
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

export const { setTrip, clearError } = tripSlice.actions;

export const selectTrip = (state) => state.trip.data;
export const selectTripStatus = (state) => state.trip.status;
export const selectTripError = (state) => state.trip.error;

export default tripSlice.reducer;
