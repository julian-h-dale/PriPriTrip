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
    } else if (!error.response && error.config?.offlineOk) {
      // A request the offline cache backs, failing for want of a network:
      // the offline bar says so — an error toast on every load would be noise.
    } else if (error.config?.handles?.includes(status)) {
      // The caller deals with this status itself (trip edits: someone else
      // changed or removed the entry, see timelineSlice).
    } else if (error.config?.background) {
      // Housekeeping the user didn't ask for (the token refresh): its
      // failure changes nothing they can see, so no toast.
    } else {
      const message =
        error.response?.data?.detail || error.message || "Something went wrong";
      store?.dispatch(setError(typeof message === "string" ? message : "Request failed"));
    }
    return Promise.reject(error);
  }
);
