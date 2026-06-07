import { createSlice } from '@reduxjs/toolkit';

const TOKEN_KEY = 'token';
const MAPS_KEY = 'mapsApiKey';

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    token: localStorage.getItem(TOKEN_KEY) ?? null,
    mapsApiKey: localStorage.getItem(MAPS_KEY) ?? null,
  },
  reducers: {
    login(state, action) {
      state.token = action.payload.token;
      state.mapsApiKey = action.payload.mapsApiKey ?? null;
      localStorage.setItem(TOKEN_KEY, action.payload.token);
      if (action.payload.mapsApiKey) {
        localStorage.setItem(MAPS_KEY, action.payload.mapsApiKey);
      }
    },
    logout(state) {
      state.token = null;
      state.mapsApiKey = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(MAPS_KEY);
    },
  },
});

export const { login, logout } = authSlice.actions;

export const selectToken = (state) => state.auth.token;
export const selectMapsApiKey = (state) => state.auth.mapsApiKey;
export const selectIsAuthenticated = (state) => !!state.auth.token;


export default authSlice.reducer;
