import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import thingsReducer from "@/features/things/thingsSlice";
import adminReducer from "@/features/admin/adminSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    things: thingsReducer,
    admin: adminReducer,
    error: errorReducer,
    notification: notificationReducer,
  },
});
