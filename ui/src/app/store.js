import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import adminReducer from "@/features/admin/adminSlice";
import journalReducer from "@/features/journal/journalSlice";
import weatherReducer from "@/features/weather/weatherSlice";
import currencyReducer from "@/features/currency/currencySlice";
import packingReducer from "@/features/packing/packingSlice";
import documentsReducer from "@/features/documents/documentsSlice";
import errorReducer from "@/shared/errorSlice";
import networkReducer from "@/shared/networkSlice";
import notificationReducer from "@/shared/notificationSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    trips: tripsReducer,
    timeline: timelineReducer,
    admin: adminReducer,
    journal: journalReducer,
    weather: weatherReducer,
    currency: currencyReducer,
    packing: packingReducer,
    documents: documentsReducer,
    error: errorReducer,
    network: networkReducer,
    notification: notificationReducer,
  },
});
