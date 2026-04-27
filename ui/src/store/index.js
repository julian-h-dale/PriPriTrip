import { configureStore } from '@reduxjs/toolkit';
import tripReducer from './tripSlice';

export const store = configureStore({
  reducer: {
    trip: tripReducer,
  },
});
