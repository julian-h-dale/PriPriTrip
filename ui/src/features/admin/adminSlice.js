import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";

export const fetchUsers = createAsyncThunk("admin/fetchUsers", async () => {
  const { data } = await apiClient.get("/admin/users", { silent: true });
  return data;
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
      });
  },
});

export default adminSlice.reducer;
