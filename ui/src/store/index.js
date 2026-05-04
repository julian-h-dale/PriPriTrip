import { configureStore } from '@reduxjs/toolkit';
import tripReducer from './tripSlice';
import authReducer from './authSlice';
import memoriesReducer from './memoriesSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    trip: tripReducer,
    memories: memoriesReducer,
  },
});
