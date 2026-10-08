import { createSlice } from "@reduxjs/toolkit";

/**
 * Whether the app may use the network:
 * - `online`: whether the browser thinks it's online; kept current from
 *   window events in main.jsx;
 * - `savedOnly`: "Use saved copies only" (Run stage 20), the drawer's switch
 *   that keeps the app offline on purpose, to save mobile data. A setting
 *   for this phone, remembered until it's turned off.
 *
 * Pages read `selectOnline` (both together), so everything built for
 * offline (saved copies, the amber bar, edits off, the outbox) works the
 * same with the switch on. `apiClient` refuses requests while it's on.
 */
const SAVED_ONLY_KEY = "savedOnly";

function readSavedOnly() {
  try {
    return localStorage.getItem(SAVED_ONLY_KEY) === "on";
  } catch {
    return false;
  }
}

const networkSlice = createSlice({
  name: "network",
  initialState: () => ({
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    savedOnly: readSavedOnly(),
    saving: false, // saving trips to the phone on the way into savedOnly
    refreshing: false, // "Refresh once": the one moment savedOnly lets requests out
  }),
  reducers: {
    setOnline(state, action) {
      state.online = action.payload;
    },
    savedOnlyChanged(state, action) {
      state.savedOnly = action.payload;
      state.saving = false;
    },
    savingForSavedOnly(state) {
      state.saving = true;
    },
    refreshingChanged(state, action) {
      state.refreshing = action.payload;
    },
  },
});

export const { setOnline, savedOnlyChanged, savingForSavedOnly, refreshingChanged } = networkSlice.actions;
export default networkSlice.reducer;

/** Whether the app may use the network: online, and not "saved copies only". */
export const selectOnline = (state) => state.network?.online !== false && !state.network?.savedOnly;

/**
 * Whether queued writes (memories) may go now: online, and either the switch
 * is off or a "Refresh once" is under way.
 */
export const selectMaySend = (state) =>
  state.network?.online !== false && (!state.network?.savedOnly || Boolean(state.network?.refreshing));

/** "Use saved copies only" is on. */
export const selectSavedOnly = (state) => Boolean(state.network?.savedOnly);

/**
 * Turn "Use saved copies only" on or off, and remember it on this phone.
 * Turning it on first saves what it can (`saveFirst`: the trips list and
 * every trip that hasn't ended, with their journals) while there's still a
 * connection, so nothing is missing later.
 */
export function setSavedOnly(on, saveFirst) {
  return async (dispatch, getState) => {
    if (on && saveFirst && getState().network?.online !== false) {
      dispatch(savingForSavedOnly());
      try {
        await saveFirst(dispatch, getState);
      } catch {
        // Whatever was saved, was saved: turn it on anyway.
      }
    }
    try {
      if (on) localStorage.setItem(SAVED_ONLY_KEY, "on");
      else localStorage.removeItem(SAVED_ONLY_KEY);
    } catch {
      // Private mode: it lasts until the app closes.
    }
    dispatch(savedOnlyChanged(on));
  };
}

/** Wire the slice to the browser's online/offline events. Returns an unsubscribe. */
export function watchNetwork(store) {
  const update = () => store.dispatch(setOnline(navigator.onLine !== false));
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}
