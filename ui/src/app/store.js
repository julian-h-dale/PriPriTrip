import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import adminReducer from "@/features/admin/adminSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    trips: tripsReducer,
    timeline: timelineReducer,
    admin: adminReducer,
    error: errorReducer,
    notification: notificationReducer,
  },
});
