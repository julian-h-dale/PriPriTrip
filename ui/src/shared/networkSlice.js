import { createSlice } from "@reduxjs/toolkit";

/** Whether the browser thinks it's online; kept current from window events in main.jsx. */
const networkSlice = createSlice({
  name: "network",
  initialState: { online: typeof navigator === "undefined" ? true : navigator.onLine !== false },
  reducers: {
    setOnline(state, action) {
      state.online = action.payload;
    },
  },
});

export const { setOnline } = networkSlice.actions;
export default networkSlice.reducer;

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
