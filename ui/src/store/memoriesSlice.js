import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import client from '../api/client';

export const fetchMemories = createAsyncThunk('memories/fetch', async () => {
  const { data } = await client.get('/api/memories');
  return data.memories ?? [];
});

export const createMemory = createAsyncThunk('memories/create', async (memory) => {
  const { data } = await client.post('/api/memories', memory);
  return data;
});

export const updateMemory = createAsyncThunk('memories/update', async (memory) => {
  const { data } = await client.put(`/api/memories/${memory.memoryId}`, memory);
  return data;
});

export const deleteMemory = createAsyncThunk('memories/delete', async (memoryId) => {
  await client.delete(`/api/memories/${memoryId}`);
  return memoryId;
});

const memoriesSlice = createSlice({
  name: 'memories',
  initialState: {
    data: [],
    status: 'idle', // 'idle' | 'loading' | 'saving' | 'error'
    error: null,
  },
  reducers: {
    clearError(state) {
      state.error = null;
      if (state.status === 'error') state.status = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      // fetch
      .addCase(fetchMemories.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchMemories.fulfilled, (state, action) => {
        state.data = action.payload;
        state.status = 'idle';
      })
      .addCase(fetchMemories.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.error.message ?? 'Failed to load memories';
      })
      // create
      .addCase(createMemory.pending, (state) => {
        state.status = 'saving';
        state.error = null;
      })
      .addCase(createMemory.fulfilled, (state, action) => {
        state.data.push(action.payload);
        state.status = 'idle';
      })
      .addCase(createMemory.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.error.message ?? 'Failed to save memory';
      })
      // update
      .addCase(updateMemory.pending, (state) => {
        state.status = 'saving';
        state.error = null;
      })
      .addCase(updateMemory.fulfilled, (state, action) => {
        const idx = state.data.findIndex((m) => m.memoryId === action.payload.memoryId);
        if (idx >= 0) state.data[idx] = action.payload;
        state.status = 'idle';
      })
      .addCase(updateMemory.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.error.message ?? 'Failed to update memory';
      })
      // delete
      .addCase(deleteMemory.pending, (state) => {
        state.status = 'saving';
        state.error = null;
      })
      .addCase(deleteMemory.fulfilled, (state, action) => {
        state.data = state.data.filter((m) => m.memoryId !== action.payload);
        state.status = 'idle';
      })
      .addCase(deleteMemory.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.error.message ?? 'Failed to delete memory';
      });
  },
});

export const { clearError } = memoriesSlice.actions;

export const selectMemories = (state) =>
  [...state.memories.data].sort((a, b) => {
    const da = `${a.date}T${a.time ?? '00:00'}`;
    const db = `${b.date}T${b.time ?? '00:00'}`;
    return db.localeCompare(da); // reverse-chronological
  });

export const selectMemoriesStatus = (state) => state.memories.status;
export const selectMemoriesError = (state) => state.memories.error;

export default memoriesSlice.reducer;
