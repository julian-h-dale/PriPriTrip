import axios from "axios";
import { appConfig } from "@/shared/config/appConfig";
import { notify } from "@/shared/notificationSlice";
import { setError } from "@/shared/errorSlice";
import { clearAuth, passwordChangeRequired } from "@/features/auth/authSlice";

// The store is injected in main.jsx to avoid a circular import.
let store;
export function injectStore(s) {
  store = s;
}

export const apiClient = axios.create({
  baseURL: appConfig.apiBaseUrl,
});

apiClient.interceptors.request.use((config) => {
  const token = store?.getState().auth.token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const WRITE_METHODS = ["post", "put", "patch", "delete"];

/** What a write that couldn't reach the server says (a read says nothing). */
export const OFFLINE_WRITE = "You’re offline, so that wasn’t saved.";

apiClient.interceptors.response.use(
  (response) => {
    // Brief success toast for write operations (see design_doc.md).
    if (WRITE_METHODS.includes(response.config.method) && !response.config.silent) {
      store?.dispatch(notify({ type: "success", message: "Saved" }));
    }
    return response;
  },
  (error) => {
    const status = error.response?.status;
    if (status === 401) {
      store?.dispatch(clearAuth());
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    } else if (status === 403 && error.response?.data?.detail === "PASSWORD_CHANGE_REQUIRED") {
      // A temporary password (an invite or a reset): the app shows the
      // "choose a new password" screen instead of an error toast.
      store?.dispatch(passwordChangeRequired());
    } else if (error.config?.background) {
      // Housekeeping the user didn't ask for (the token refresh): its
      // failure changes nothing they can see, so no toast.
    } else if (!error.response && (!WRITE_METHODS.includes(error.config?.method) || error.config?.offlineOk)) {
      // A read (or an outbox write) failing for want of a network: the
      // offline bar says so, and each page shows the phone's saved copy or
      // its own "needs a connection" note. A toast on every load was noise.
    } else if (error.config?.handles?.includes(status)) {
      // The caller deals with this status itself (trip edits: someone else
      // changed or removed the entry, see timelineSlice).
    } else if (!error.response) {
      // A write the user made that couldn't go: say so plainly, once.
      store?.dispatch(setError(OFFLINE_WRITE));
    } else {
      const message =
        error.response?.data?.detail || error.message || "Something went wrong";
      store?.dispatch(setError(typeof message === "string" ? message : "Request failed"));
    }
    return Promise.reject(error);
  }
);
