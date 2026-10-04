import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { clearOutbox } from "@/shared/services/outbox";
import { clearUser } from "@/shared/services/tripCache";
import { tokenExpiry, userIdFromToken } from "@/shared/utils/authToken";

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

const DAY_MS = 24 * 60 * 60 * 1000;
// The server's token lifetime (JWT_EXPIRY_HOURS, 60 days). A token with less
// than this minus a day left is over a day old, so it's worth swapping. If
// the server's lifetime is ever shorter, this just refreshes on every open.
const TOKEN_LIFETIME_MS = 60 * DAY_MS;

/** True when the token is over a day old and still unexpired (so refreshable). */
export function tokenNeedsRefresh(token, now = Date.now()) {
  const exp = tokenExpiry(token);
  if (!exp || exp <= now) return false;
  return exp - now < TOKEN_LIFETIME_MS - DAY_MS;
}

/**
 * A sliding sign-in: swap a token over a day old for a fresh 60-day one, so
 * using the app within 60 days keeps you signed in. Quiet: a failure leaves
 * the current token in place (it still works until it expires), and an
 * already-expired one gets the usual 401 sign-out.
 */
export const refreshToken = createAsyncThunk(
  "auth/refreshToken",
  async () => {
    const { data } = await apiClient.post("/auth/refresh", null, { silent: true, background: true });
    return data.access_token;
  },
  { condition: (_, { getState }) => tokenNeedsRefresh(getState().auth.token) }
);

export const fetchMe =createAsyncThunk("auth/fetchMe", async () => {
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
      .addCase(refreshToken.fulfilled, (state, action) => {
        // Only if still signed in as the same person (a sign-out may have
        // happened while it was in flight).
        if (state.token && userIdFromToken(state.token) === userIdFromToken(action.payload)) {
          state.token = action.payload;
          localStorage.setItem(TOKEN_KEY, action.payload);
        }
      })
      .addCase(fetchMe.fulfilled, (state, action) => {
        state.user = action.payload;
      });
  },
});

export const { clearAuth } = authSlice.actions;
export default authSlice.reducer;
