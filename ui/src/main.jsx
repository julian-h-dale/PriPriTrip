import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { store } from "@/app/store";
import { injectStore } from "@/shared/services/apiClient";
import { watchNetwork } from "@/shared/networkSlice";
import { App } from "@/app/App";
import "@/index.css";

injectStore(store);
watchNetwork(store);
// Ask the browser not to clear the app's storage under pressure: photos
// waiting to upload live there (granted for an installed app on most
// browsers; best effort).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>
);
