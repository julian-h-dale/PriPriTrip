import { createSlice } from '@reduxjs/toolkit';

const TOKEN_KEY = 'token';

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    token: localStorage.getItem(TOKEN_KEY) ?? null,
  },
  reducers: {
    login(state, action) {
      state.token = action.payload;
      localStorage.setItem(TOKEN_KEY, action.payload);
    },
    logout(state) {
      state.token = null;
      localStorage.removeItem(TOKEN_KEY);
    },
  },
});

export const { login, logout } = authSlice.actions;

export const selectToken = (state) => state.auth.token;
export const selectIsAuthenticated = (state) => !!state.auth.token;

export default authSlice.reducer;
