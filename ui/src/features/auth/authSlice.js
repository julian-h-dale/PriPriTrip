import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { clearOutbox } from "@/shared/services/outbox";
import { clearUser } from "@/shared/services/tripCache";
import { userIdFromToken } from "@/shared/utils/authToken";

const TOKEN_KEY = "auth_token";

// fastapi-users login expects form-encoded username/password.
export const login = createAsyncThunk(
  "auth/login",
  async ({ email, password }) => {
    const form = new URLSearchParams();
    form.append("username", email);
    form.append("password", password);
    const { data } = await apiClient.post("/auth/login", form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      silent: true,
    });
    localStorage.setItem(TOKEN_KEY, data.access_token);
    return data.access_token;
  }
);

/**
 * An explicit sign-out also forgets this user's offline trips and any
 * memories still waiting to sync (the drawer warns about those first). An
 * expired token — a 401 — only clears auth: both stay, keyed by user, so
 * signing back in shows the trips at once and sends the waiting memories.
 */
export const signOut = createAsyncThunk("auth/signOut", async (_, { dispatch, getState }) => {
  const userId = userIdFromToken(getState().auth.token);
  await clearUser(userId);
  await clearOutbox(userId);
  dispatch(authSlice.actions.clearAuth());
});

export const fetchMe = createAsyncThunk("auth/fetchMe", async () => {
  const { data } = await apiClient.get("/users/me", { silent: true, offlineOk: true });
  return data;
});

const authSlice = createSlice({
  name: "auth",
  initialState: {
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    status: "idle",
  },
  reducers: {
    clearAuth(state) {
      state.token = null;
      state.user = null;
      localStorage.removeItem(TOKEN_KEY);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = "loading";
      })
      .addCase(login.fulfilled, (state, action) => {
        state.status = "idle";
        state.token = action.payload;
      })
      .addCase(login.rejected, (state) => {
        state.status = "idle";
      })
      .addCase(fetchMe.fulfilled, (state, action) => {
        state.user = action.payload;
      });
  },
});

export const { clearAuth } = authSlice.actions;
export default authSlice.reducer;
