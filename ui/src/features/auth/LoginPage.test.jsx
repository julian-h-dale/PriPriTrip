import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import tripsReducer from "@/features/trips/tripsSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { LoginPage } from "@/features/auth/LoginPage";

function renderWithStore(ui) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      trips: tripsReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {ui}
      </MemoryRouter>
    </Provider>
  );
}

describe("LoginPage", () => {
  it("renders the sign-in form", () => {
    renderWithStore(<LoginPage />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("validates required fields on submit", async () => {
    renderWithStore(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });

  it("unmasks and re-masks the password with the eye toggle", async () => {
    const user = userEvent.setup();
    renderWithStore(<LoginPage />);
    const field = screen.getByLabelText("Password");
    await user.type(field, "s3cret");
    expect(field).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("s3cret");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field).toHaveAttribute("type", "password");
  });

  it("toggling the eye does not submit the form", async () => {
    const user = userEvent.setup();
    renderWithStore(<LoginPage />);
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.queryByText(/required/i)).not.toBeInTheDocument();
  });
});
