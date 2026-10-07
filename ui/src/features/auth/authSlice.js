import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";
import { clearOutbox } from "@/shared/services/outbox";
import { clearUser } from "@/shared/services/tripCache";
import { tokenExpiry, userIdFromToken } from "@/shared/utils/authToken";

const TOKEN_KEY = "auth_token";

/**
 * The password just typed at sign-in, kept in this module only (never in
 * Redux or storage), so the forced change after an invite or reset needn't
 * ask for the temporary password again. Dropped once the account turns out
 * not to need a change, after the change, and on sign-out. After a reload
 * it's gone, and the form asks for it.
 */
let signInPassword = null;

/** The password typed at this sign-in, if it's still held. */
export function heldSignInPassword() {
  return signInPassword;
}

export function forgetSignInPassword() {
  signInPassword = null;
}

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
    signInPassword = password;
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
  forgetSignInPassword();
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

/**
 * Choose a new password (required while holding an admin-issued temporary
 * one). Answers with a fresh token. A wrong current password (400) or a weak
 * new one (422) comes back as `{ message }` for the form to show.
 */
export const changePassword = createAsyncThunk(
  "auth/changePassword",
  async ({ currentPassword, newPassword }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post(
        "/auth/change-password",
        { currentPassword, newPassword },
        { silent: true, handles: [400, 422] }
      );
      localStorage.setItem(TOKEN_KEY, data.access_token);
      forgetSignInPassword();
      return data.access_token;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      return rejectWithValue({ message: typeof detail === "string" ? detail : "Couldn’t change the password" });
    }
  }
);

export const fetchMe = createAsyncThunk("auth/fetchMe", async () => {
  const { data } = await apiClient.get("/users/me", { silent: true, offlineOk: true });
  if (!data?.must_change_password) forgetSignInPassword();
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
    /** The server said this account must change its password first (403 PASSWORD_CHANGE_REQUIRED). */
    passwordChangeRequired(state) {
      state.user = { ...(state.user ?? {}), must_change_password: true };
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
      })
      .addCase(changePassword.fulfilled, (state, action) => {
        state.token = action.payload;
        if (state.user) state.user.must_change_password = false;
      })
      // An admin changing their own analytics on the Admin page takes effect
      // now, not on the next load (by type: the admin slice imports nothing here).
      .addMatcher(
        (action) => action.type === "admin/setAnalytics/fulfilled",
        (state, action) => {
          if (state.user?.id === action.payload.id) state.user.analytics_enabled = action.payload.analytics_enabled;
        },
      );
  },
});

export const { clearAuth, passwordChangeRequired } = authSlice.actions;

/** True while the signed-in account still has a temporary password. */
export const selectMustChangePassword = (state) => Boolean(state.auth.user?.must_change_password);
export default authSlice.reducer;
