import { configureStore } from '@reduxjs/toolkit';
import tripReducer from './tripSlice';
import authReducer from './authSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    trip: tripReducer,
  },
});
