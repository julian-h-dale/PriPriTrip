import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";

export const fetchUsers = createAsyncThunk("admin/fetchUsers", async () => {
  const { data } = await apiClient.get("/admin/users", { silent: true });
  return data;
});

/** Invite someone: resolves to `{ user, temporaryPassword }` (shown once). */
export const inviteUser = createAsyncThunk("admin/inviteUser", async ({ email, name }, { rejectWithValue }) => {
  try {
    const { data } = await apiClient.post("/admin/users", { email, name }, { silent: true, handles: [409, 422] });
    return data;
  } catch (err) {
    const detail = err?.response?.data?.detail;
    return rejectWithValue({
      message: typeof detail === "string" ? detail : "Check the email address and try again",
    });
  }
});

/** Reset someone's password: resolves to `{ userId, temporaryPassword }` (shown once). */
export const resetPassword = createAsyncThunk("admin/resetPassword", async (userId) => {
  const { data } = await apiClient.post(`/admin/users/${userId}/reset-password`, null, { silent: true });
  return { userId, temporaryPassword: data.temporaryPassword };
});

const adminSlice = createSlice({
  name: "admin",
  initialState: { users: [], status: "idle" },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchUsers.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchUsers.fulfilled, (state, action) => {
        state.status = "idle";
        state.users = action.payload;
      })
      .addCase(fetchUsers.rejected, (state) => {
        state.status = "idle";
      })
      .addCase(inviteUser.fulfilled, (state, action) => {
        state.users = [...state.users, action.payload.user].sort((a, b) => a.email.localeCompare(b.email));
      })
      .addCase(resetPassword.fulfilled, (state, action) => {
        const user = state.users.find((u) => u.id === action.payload.userId);
        if (user) user.must_change_password = true;
      });
  },
});

export default adminSlice.reducer;
