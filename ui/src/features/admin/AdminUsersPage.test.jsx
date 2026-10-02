import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import adminReducer from "@/features/admin/adminSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { TripsPage } from "@/features/trips/TripsPage";
import { AdminRoute } from "@/shared/components/AdminRoute";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ data: [] }) },
}));

function makeStore(preloadedState) {
  return configureStore({
    reducer: {
      auth: authReducer,
      trips: tripsReducer,
      admin: adminReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState,
  });
}

function renderWith(ui, store, initialEntries = ["/"]) {
  return render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={initialEntries}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {ui}
      </MemoryRouter>
    </Provider>
  );
}

describe("Admin navigation button", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the Admin button for superusers", async () => {
    const store = makeStore({
      auth: { token: "t", user: { email: "a@x.com", is_superuser: true }, status: "idle" },
    });
    renderWith(<TripsPage />, store);
    expect(await screen.findByRole("button", { name: /admin/i })).toBeInTheDocument();
  });

  it("hides the Admin button for non-superusers", async () => {
    const store = makeStore({
      auth: { token: "t", user: { email: "u@x.com", is_superuser: false }, status: "idle" },
    });
    renderWith(<TripsPage />, store);
    // Flush the trips page's on-mount fetch before asserting.
    await screen.findByRole("button", { name: /sign out/i });
    expect(screen.queryByRole("button", { name: /admin/i })).not.toBeInTheDocument();
  });
});

describe("AdminRoute", () => {
  const guarded = (
    <Routes>
      <Route path="/" element={<div>dashboard</div>} />
      <Route path="/login" element={<div>login</div>} />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <div>admin page</div>
          </AdminRoute>
        }
      />
    </Routes>
  );

  it("renders admin content for superusers", () => {
    const store = makeStore({
      auth: { token: "t", user: { email: "a@x.com", is_superuser: true }, status: "idle" },
    });
    renderWith(guarded, store, ["/admin"]);
    expect(screen.getByText("admin page")).toBeInTheDocument();
  });

  it("redirects non-superusers to the dashboard", () => {
    const store = makeStore({
      auth: { token: "t", user: { email: "u@x.com", is_superuser: false }, status: "idle" },
    });
    renderWith(guarded, store, ["/admin"]);
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    expect(screen.queryByText("admin page")).not.toBeInTheDocument();
  });

  it("redirects unauthenticated users to login", () => {
    const store = makeStore({ auth: { token: null, user: null, status: "idle" } });
    renderWith(guarded, store, ["/admin"]);
    expect(screen.getByText("login")).toBeInTheDocument();
  });
});
