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

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>
);
