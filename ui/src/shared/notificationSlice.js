import { createSlice } from "@reduxjs/toolkit";

let nextId = 1;

const notificationSlice = createSlice({
  name: "notification",
  initialState: { items: [] },
  reducers: {
    notify: {
      reducer(state, action) {
        // The same toast already showing isn't shown twice (offline, the
        // same thing can be said several times in a row).
        const { type, message } = action.payload;
        if (state.items.some((n) => n.type === type && n.message === message)) return;
        state.items.push(action.payload);
      },
      prepare({ type = "info", message }) {
        return { payload: { id: nextId++, type, message } };
      },
    },
    dismiss(state, action) {
      state.items = state.items.filter((n) => n.id !== action.payload);
    },
  },
});

export const { notify, dismiss } = notificationSlice.actions;
export default notificationSlice.reducer;
