import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";

export const fetchThings = createAsyncThunk("things/fetch", async () => {
  const { data } = await apiClient.get("/things/", { silent: true });
  return data;
});

export const createThing = createAsyncThunk("things/create", async (payload) => {
  const { data } = await apiClient.post("/things/", payload);
  return data;
});

export const deleteThing = createAsyncThunk("things/delete", async (id) => {
  await apiClient.delete(`/things/${id}`);
  return id;
});

const thingsSlice = createSlice({
  name: "things",
  initialState: { items: [], status: "idle" },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchThings.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchThings.fulfilled, (state, action) => {
        state.status = "idle";
        state.items = action.payload;
      })
      .addCase(createThing.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
      })
      .addCase(deleteThing.fulfilled, (state, action) => {
        state.items = state.items.filter((t) => t.id !== action.payload);
      });
  },
});

export default thingsSlice.reducer;
