import { createSlice } from '@reduxjs/toolkit';

const TOKEN_KEY = 'token';
const MAPS_API_KEY = 'mapsApiKey';

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    token: localStorage.getItem(TOKEN_KEY) ?? null,
    mapsApiKey: localStorage.getItem(MAPS_API_KEY) ?? '',
  },
  reducers: {
    login(state, action) {
      const { token, mapsApiKey = '' } = action.payload ?? {};
      state.token = token ?? null;
      state.mapsApiKey = mapsApiKey;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(MAPS_API_KEY, mapsApiKey);
    },
    logout(state) {
      state.token = null;
      state.mapsApiKey = '';
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(MAPS_API_KEY);
    },
  },
});

export const { login, logout } = authSlice.actions;

export const selectToken = (state) => state.auth.token;
export const selectMapsApiKey = (state) => state.auth.mapsApiKey;
export const selectIsAuthenticated = (state) => !!state.auth.token;

export default authSlice.reducer;
