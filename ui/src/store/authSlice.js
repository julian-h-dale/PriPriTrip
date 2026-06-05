import { createSlice } from '@reduxjs/toolkit';

const TOKEN_KEY = 'token';

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    token: localStorage.getItem(TOKEN_KEY) ?? null,
    mapsApiKey: '',
  },
  reducers: {
    login(state, action) {
      const { token, mapsApiKey = '' } = action.payload ?? {};
      state.token = token ?? null;
      state.mapsApiKey = mapsApiKey;
      if (token) localStorage.setItem(TOKEN_KEY, token);
    },
    logout(state) {
      state.token = null;
      state.mapsApiKey = '';
      localStorage.removeItem(TOKEN_KEY);
    },
  },
});

export const { login, logout } = authSlice.actions;

export const selectToken = (state) => state.auth.token;
export const selectMapsApiKey = (state) => state.auth.mapsApiKey;
export const selectIsAuthenticated = (state) => !!state.auth.token;

export default authSlice.reducer;
