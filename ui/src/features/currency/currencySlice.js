import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchRates, isFresh, storedRates } from "@/features/currency/rates";

/**
 * USD exchange rates for the Currency page, cached on the device
 * (features/currency/rates.js). `loadRates(codes)` makes no request while the
 * stored rates cover `codes` and are under 12 hours old.
 */
export const loadRates = createAsyncThunk("currency/load", async (codes, { rejectWithValue }) => {
  const stored = storedRates();
  if (codes.length === 0 || isFresh(stored, codes)) return stored;
  try {
    return await fetchRates(codes);
  } catch (err) {
    return rejectWithValue({ stored, message: err?.message ?? "Couldn’t get today’s rate" });
  }
});

const currencySlice = createSlice({
  name: "currency",
  initialState: { rates: {}, fetchedAt: null, status: "idle", error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadRates.pending, (state) => {
        const stored = storedRates();
        state.rates = stored.rates;
        state.fetchedAt = stored.fetchedAt;
        state.status = "loading";
      })
      .addCase(loadRates.fulfilled, (state, action) => {
        state.rates = action.payload.rates;
        state.fetchedAt = action.payload.fetchedAt;
        state.status = "ready";
        state.error = null;
      })
      .addCase(loadRates.rejected, (state, action) => {
        state.rates = action.payload?.stored.rates ?? state.rates;
        state.fetchedAt = action.payload?.stored.fetchedAt ?? state.fetchedAt;
        state.status = "failed";
        state.error = action.payload?.message ?? "Couldn’t get today’s rate";
      });
  },
});

export default currencySlice.reducer;
