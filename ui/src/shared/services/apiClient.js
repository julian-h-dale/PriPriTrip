import axios from "axios";
import { appConfig } from "@/shared/config/appConfig";
import { notify } from "@/shared/notificationSlice";
import { setError } from "@/shared/errorSlice";
import { clearAuth } from "@/features/auth/authSlice";

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
    } else {
      const message =
        error.response?.data?.detail || error.message || "Something went wrong";
      store?.dispatch(setError(typeof message === "string" ? message : "Request failed"));
    }
    return Promise.reject(error);
  }
);
