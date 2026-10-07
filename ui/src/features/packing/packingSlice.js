import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { apiClient } from "@/shared/services/apiClient";

/**
 * Your own packing list for one trip (GET /trips/:id/packing). Ticking is
 * optimistic: the box flips at once and flips back if the server says no.
 * Writes are silent (no "Saved" toast for every tick); failures still toast.
 */
export const fetchPacking = createAsyncThunk("packing/fetch", async (tripId) => {
  const { data } = await apiClient.get(`/trips/${tripId}/packing`, { silent: true, offlineOk: true });
  return { tripId, items: data };
});

export const addPackingItem = createAsyncThunk("packing/add", async ({ tripId, category, text, quantity = 1 }) => {
  const { data } = await apiClient.post(`/trips/${tripId}/packing`, { category, text, quantity }, { silent: true });
  return data;
});

/** `changes`: any of { text, quantity, checked, category }. */
export const updatePackingItem = createAsyncThunk("packing/update", async ({ tripId, id, changes }) => {
  const { data } = await apiClient.patch(`/trips/${tripId}/packing/${id}`, changes, { silent: true });
  return data;
});

export const deletePackingItem = createAsyncThunk("packing/delete", async ({ tripId, id }) => {
  await apiClient.delete(`/trips/${tripId}/packing/${id}`, { silent: true });
  return id;
});

/** Delete one of your lists: every line on it. */
export const deletePackingList = createAsyncThunk("packing/deleteList", async ({ tripId, category }) => {
  await apiClient.delete(`/trips/${tripId}/packing/lists/${category}`, { silent: true });
  return category;
});

export const addPackingSuggestions = createAsyncThunk("packing/suggestions", async (tripId) => {
  const { data } = await apiClient.post(`/trips/${tripId}/packing/suggestions`, null, { silent: true });
  return { tripId, items: data };
});

const packingSlice = createSlice({
  name: "packing",
  initialState: { tripId: null, items: [], status: "idle" },
  reducers: {},
  extraReducers: (builder) => {
    const replaceList = (state, action) => {
      if (state.tripId !== action.payload.tripId) return;
      state.items = action.payload.items;
      state.status = "ready";
    };
    builder
      .addCase(fetchPacking.pending, (state, action) => {
        if (state.tripId !== action.meta.arg) {
          state.tripId = action.meta.arg;
          state.items = [];
          state.status = "loading";
        }
      })
      .addCase(fetchPacking.fulfilled, replaceList)
      .addCase(fetchPacking.rejected, (state, action) => {
        if (state.tripId === action.meta.arg && state.status === "loading") state.status = "failed";
      })
      .addCase(addPackingSuggestions.fulfilled, replaceList)
      .addCase(addPackingItem.fulfilled, (state, action) => {
        if (state.tripId === action.meta.arg.tripId) state.items.push(action.payload);
      })
      .addCase(updatePackingItem.pending, (state, action) => {
        // Optimistic, with the previous values kept on the item for a rollback.
        const item = state.items.find((i) => i.id === action.meta.arg.id);
        if (!item) return;
        const { text, quantity, checked, category, position } = item;
        item.before = { text, quantity, checked, category, position };
        Object.assign(item, action.meta.arg.changes);
      })
      .addCase(updatePackingItem.fulfilled, (state, action) => {
        const at = state.items.findIndex((i) => i.id === action.payload.id);
        if (at >= 0) state.items[at] = action.payload;
      })
      .addCase(updatePackingItem.rejected, (state, action) => {
        const item = state.items.find((i) => i.id === action.meta.arg.id);
        if (item?.before) Object.assign(item, item.before);
        if (item) delete item.before;
      })
      .addCase(deletePackingItem.fulfilled, (state, action) => {
        state.items = state.items.filter((i) => i.id !== action.payload);
      })
      .addCase(deletePackingList.fulfilled, (state, action) => {
        if (state.tripId !== action.meta.arg.tripId) return;
        state.items = state.items.filter((i) => i.category !== action.payload);
      });
  },
});

export default packingSlice.reducer;
