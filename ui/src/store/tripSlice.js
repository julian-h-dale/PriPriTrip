import { createSlice } from '@reduxjs/toolkit';
import fixtureTrip from '../fixtures/trip.json';

const tripSlice = createSlice({
  name: 'trip',
  initialState: {
    // Phase 2: seeded with fixture data. Phases 3-4 will replace this via API.
    data: fixtureTrip,
    status: 'idle', // 'idle' | 'loading' | 'error'
    error: null,
  },
  reducers: {
    setTrip(state, action) {
      state.data = action.payload;
      state.status = 'idle';
      state.error = null;
    },
    setStatus(state, action) {
      state.status = action.payload;
    },
    setError(state, action) {
      state.error = action.payload;
      state.status = 'error';
    },
  },
});

export const { setTrip, setStatus, setError } = tripSlice.actions;

export const selectTrip = (state) => state.trip.data;
export const selectTripStatus = (state) => state.trip.status;
export const selectTripError = (state) => state.trip.error;

export default tripSlice.reducer;
