import { createSlice } from "@reduxjs/toolkit";

let nextId = 1;

const notificationSlice = createSlice({
  name: "notification",
  initialState: { items: [] },
  reducers: {
    notify: {
      reducer(state, action) {
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
