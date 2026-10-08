import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import adminReducer from "@/features/admin/adminSlice";
import authReducer, {
  fetchMe,
  forgetSignInPassword,
  heldSignInPassword,
  login,
  passwordChangeRequired,
  signOut,
} from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import errorReducer from "@/shared/errorSlice";
import networkReducer from "@/shared/networkSlice";
import notificationReducer from "@/shared/notificationSlice";
import { AdminUsersPage } from "@/features/admin/AdminUsersPage";
import { AdminRoute } from "@/shared/components/AdminRoute";
import { ProtectedRoute } from "@/shared/components/ProtectedRoute";
import { TopBar } from "@/shared/components/TopBar";
import { apiClient } from "@/shared/services/apiClient";

vi.mock("@/shared/services/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const ADMIN = { id: "a1", email: "admin@example.com", is_superuser: true, is_active: true, must_change_password: false };
const USER = { id: "u1", email: "user@example.com", is_superuser: false, is_active: true, must_change_password: false };

function renderAt(path, user, routes) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      admin: adminReducer,
      journal: journalReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: "t", user, status: "idle" } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>{routes}</Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

const withBar = (path, user) =>
  renderAt(path, user, [
    <Route key="t" path="/trips" element={<TopBar title="Trips" />} />,
    <Route key="d" path="/trips/:id" element={<TopBar title="A trip" />} />,
  ]);

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
  return screen.getByRole("navigation", { name: "Menu" });
}

beforeEach(() => vi.clearAllMocks());

describe("the drawer", () => {
  it("offers Invite someone to admins on the trips screen only", async () => {
    withBar("/trips", ADMIN);
    expect(within(await openMenu()).getByRole("button", { name: "Invite someone" })).toBeInTheDocument();
  });

  it("has no Invite inside a trip", async () => {
    withBar("/trips/t1", ADMIN);
    expect(within(await openMenu()).queryByRole("button", { name: "Invite someone" })).not.toBeInTheDocument();
  });

  it("has no Invite for non-admins", async () => {
    withBar("/trips", USER);
    expect(within(await openMenu()).queryByRole("button", { name: "Invite someone" })).not.toBeInTheDocument();
  });

  it("invites someone and shows the temporary password once", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({
      data: { user: { ...USER, id: "n1", email: "inlaw@example.com", must_change_password: true }, temporaryPassword: "k7mq-x2pd-9rhw" },
    });
    withBar("/trips", ADMIN);
    await user.click(within(await openMenu()).getByRole("button", { name: "Invite someone" }));
    const dialog = screen.getByRole("dialog", { name: "Invite someone" });
    await user.type(within(dialog).getByLabelText("Email"), "inlaw@example.com");
    await user.type(within(dialog).getByLabelText("Name (optional)"), "Grandma");
    await user.click(within(dialog).getByRole("button", { name: "Create account" }));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/admin/users",
      { email: "inlaw@example.com", name: "Grandma" },
      expect.objectContaining({ handles: [409, 422] })
    );
    const sent = await screen.findByRole("dialog", { name: "Send them this" });
    expect(within(sent).getByText("k7mq-x2pd-9rhw")).toBeInTheDocument();
    expect(within(sent).getByRole("button", { name: "Copy temporary password" })).toBeInTheDocument();
  });

  it("shows why an invite was refused", async () => {
    const user = userEvent.setup();
    apiClient.post.mockRejectedValue({ response: { status: 409, data: { detail: "Someone already has that email" } } });
    withBar("/trips", ADMIN);
    await user.click(within(await openMenu()).getByRole("button", { name: "Invite someone" }));
    const dialog = screen.getByRole("dialog", { name: "Invite someone" });
    await user.type(within(dialog).getByLabelText("Email"), "user@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create account" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Someone already has that email");
  });

  it("lets anyone change their password, checking it first", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: { access_token: "new-token" } });
    const store = withBar("/trips/t1", USER);
    await user.click(within(await openMenu()).getByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog", { name: "Change password" });
    await user.type(within(dialog).getByLabelText("Current password"), "old password");
    await user.type(within(dialog).getByLabelText("New password"), "short");
    await user.type(within(dialog).getByLabelText("New password again"), "short");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("at least 8");
    await user.clear(within(dialog).getByLabelText("New password"));
    await user.type(within(dialog).getByLabelText("New password"), "a longer one");
    await user.clear(within(dialog).getByLabelText("New password again"));
    await user.type(within(dialog).getByLabelText("New password again"), "a longer one!");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("don’t match");
    await user.clear(within(dialog).getByLabelText("New password again"));
    await user.type(within(dialog).getByLabelText("New password again"), "a longer one");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/auth/change-password",
      { currentPassword: "old password", newPassword: "a longer one" },
      expect.anything()
    );
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(store.getState().auth.token).toBe("new-token");
    expect(store.getState().notification.items.map((n) => n.message)).toContain("Password changed");
  });
});

describe("the forced password change", () => {
  const app = (user) =>
    renderAt("/trips", user, [
      <Route
        key="t"
        path="/trips"
        element={
          <ProtectedRoute>
            <p>The trips list</p>
          </ProtectedRoute>
        }
      />,
    ]);

  it("replaces the app until a new password is chosen", async () => {
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: { access_token: "fresh" } });
    app({ ...USER, must_change_password: true });
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.queryByText("The trips list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Temporary password"), "k7mq-x2pd-9rhw");
    await user.type(screen.getByLabelText("New password"), "my own password");
    await user.type(screen.getByLabelText("New password again"), "my own password");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("The trips list")).toBeInTheDocument();
  });

  describe("straight after signing in", () => {
    const signIn = async (password) => {
      apiClient.post.mockResolvedValueOnce({ data: { access_token: "t" } });
      await configureStore({ reducer: { auth: authReducer } }).dispatch(
        login({ email: "user@example.com", password })
      );
    };
    beforeEach(() => forgetSignInPassword());

    it("doesn't ask for the temporary password again", async () => {
      const user = userEvent.setup();
      await signIn("k7mq-x2pd-9rhw");
      apiClient.post.mockResolvedValue({ data: { access_token: "fresh" } });
      app({ ...USER, must_change_password: true });
      expect(screen.queryByLabelText("Temporary password")).not.toBeInTheDocument();

      await user.type(screen.getByLabelText("New password"), "my own password");
      await user.type(screen.getByLabelText("New password again"), "my own password");
      await user.click(screen.getByRole("button", { name: "Save password" }));
      expect(await screen.findByText("The trips list")).toBeInTheDocument();
      expect(apiClient.post).toHaveBeenLastCalledWith(
        "/auth/change-password",
        { currentPassword: "k7mq-x2pd-9rhw", newPassword: "my own password" },
        expect.anything()
      );
      expect(heldSignInPassword()).toBeNull();
    });

    it("keeps the password out of storage and the store", async () => {
      await signIn("k7mq-x2pd-9rhw");
      expect(JSON.stringify({ ...localStorage })).not.toContain("k7mq");
      const store = app({ ...USER, must_change_password: true });
      expect(JSON.stringify(store.getState())).not.toContain("k7mq");
    });

    it("forgets it when no change is needed, or on sign-out", async () => {
      await signIn("secret-one");
      apiClient.get.mockResolvedValueOnce({ data: USER });
      await configureStore({ reducer: { auth: authReducer } }).dispatch(fetchMe());
      expect(heldSignInPassword()).toBeNull();

      await signIn("secret-two");
      expect(heldSignInPassword()).toBe("secret-two");
      await configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: { token: null, user: null, status: "idle" } } }).dispatch(signOut());
      expect(heldSignInPassword()).toBeNull();
    });
  });

  it("shows the server's reason, and stays put", async () => {
    const user = userEvent.setup();
    apiClient.post.mockRejectedValue({ response: { status: 400, data: { detail: "Your current password isn't right" } } });
    app({ ...USER, must_change_password: true });
    await user.type(screen.getByLabelText("Temporary password"), "wrong");
    await user.type(screen.getByLabelText("New password"), "my own password");
    await user.type(screen.getByLabelText("New password again"), "my own password");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("current password isn't right");
    expect(screen.queryByText("The trips list")).not.toBeInTheDocument();
  });

  it("a 403 PASSWORD_CHANGE_REQUIRED from the server turns it on", () => {
    const state = authReducer({ token: "t", user: USER, status: "idle" }, passwordChangeRequired());
    expect(state.user.must_change_password).toBe(true);
  });

  it("also guards the admin pages", () => {
    renderAt("/admin", { ...ADMIN, must_change_password: true }, [
      <Route key="a" path="/admin" element={<AdminRoute><p>Admin stuff</p></AdminRoute>} />,
    ]);
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.queryByText("Admin stuff")).not.toBeInTheDocument();
  });
});

describe("resetting a password on the Admin page", () => {
  it("needs a second tap, then shows the new temporary password; not for yourself", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [ADMIN, { ...USER, must_change_password: false }] });
    apiClient.post.mockResolvedValue({ data: { temporaryPassword: "abcd-efgh-2345" } });
    renderAt("/admin", ADMIN, [<Route key="a" path="/admin" element={<AdminUsersPage />} />]);
    const userRow = (await screen.findByText("user@example.com")).closest("tr");
    const adminRow = screen.getAllByText("admin@example.com")[0].closest("tr");
    expect(within(adminRow).queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();

    await user.click(within(userRow).getByRole("button", { name: "Reset user@example.com’s password" }));
    expect(apiClient.post).not.toHaveBeenCalled();
    await user.click(within(userRow).getByRole("button", { name: "Confirm resetting user@example.com’s password" }));
    expect(apiClient.post).toHaveBeenCalledWith("/admin/users/u1/reset-password", null, { silent: true });
    const dialog = await screen.findByRole("dialog", { name: "Password reset" });
    expect(within(dialog).getByText("abcd-efgh-2345")).toBeInTheDocument();
    expect(within(userRow).getByText("Must change")).toBeInTheDocument();
  });
});

describe("making someone an admin on the Admin page", () => {
  it("a Role choice on each row asks first, then saves; your own row is just a badge", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [ADMIN, { ...USER, is_superuser: false }] });
    apiClient.patch.mockResolvedValue({ data: { ...USER, is_superuser: true } });
    renderAt("/admin", ADMIN, [<Route key="a" path="/admin" element={<AdminUsersPage />} />]);
    const userRow = (await screen.findByText("user@example.com")).closest("tr");
    const adminRow = screen.getAllByText("admin@example.com")[0].closest("tr");
    expect(within(adminRow).queryByRole("combobox", { name: /Role for/ })).not.toBeInTheDocument();
    expect(within(adminRow).getByText("You")).toBeInTheDocument();

    const role = within(userRow).getByRole("combobox", { name: "Role for user@example.com" });
    expect(role).toHaveValue("user");
    await user.selectOptions(role, "admin");
    const confirm = screen.getByRole("dialog", { name: "Make them an admin?" });
    expect(confirm).toHaveTextContent("user@example.com will be able to invite people");
    expect(apiClient.patch).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Make admin" }));
    expect(apiClient.patch).toHaveBeenCalledWith("/admin/users/u1", { isSuperuser: true }, expect.objectContaining({ silent: true }));
    await waitFor(() => expect(within(userRow).getByRole("combobox", { name: "Role for user@example.com" })).toHaveValue("admin"));
  });

  it("Cancel changes nothing", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [ADMIN, { ...USER, is_superuser: true }] });
    renderAt("/admin", ADMIN, [<Route key="a" path="/admin" element={<AdminUsersPage />} />]);
    const role = await screen.findByRole("combobox", { name: "Role for user@example.com" });
    await user.selectOptions(role, "user");
    await user.click(within(screen.getByRole("dialog", { name: "Make them a user?" })).getByRole("button", { name: "Cancel" }));
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(role).toHaveValue("admin");
  });

  it("the server's refusal (the last admin) is said, and the row stays", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: [ADMIN, { ...USER, is_superuser: true }] });
    apiClient.patch.mockRejectedValue({ response: { status: 409, data: { detail: "There has to be at least one admin" } } });
    const store = renderAt("/admin", ADMIN, [<Route key="a" path="/admin" element={<AdminUsersPage />} />]);
    const role = await screen.findByRole("combobox", { name: "Role for user@example.com" });
    await user.selectOptions(role, "user");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Make user" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.stringify(store.getState().notification)).toContain("There has to be at least one admin");
    expect(role).toHaveValue("admin");
  });
});

describe("the analytics switch on the Admin page", () => {
  it("shows On or Off on every row, your own included, and saves a change straight away", async () => {
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue({
      data: [
        { ...ADMIN, analytics_enabled: false },
        { ...USER, analytics_enabled: true },
      ],
    });
    apiClient.patch.mockResolvedValue({ data: { ...USER, analytics_enabled: false } });
    renderAt("/admin", ADMIN, [<Route key="a" path="/admin" element={<AdminUsersPage />} />]);
    expect(await screen.findByRole("combobox", { name: "Analytics for admin@example.com" })).toHaveValue("off");
    const theirs = screen.getByRole("combobox", { name: "Analytics for user@example.com" });
    expect(theirs).toHaveValue("on");
    await user.selectOptions(theirs, "off");
    expect(apiClient.patch).toHaveBeenCalledWith("/admin/users/u1", { analyticsEnabled: false }, expect.objectContaining({ silent: true }));
    await waitFor(() => expect(theirs).toHaveValue("off"));
  });

  it("changing your own takes effect now, not on the next load", async () => {
    const user = userEvent.setup();
    const me = { ...ADMIN, analytics_enabled: false };
    apiClient.get.mockResolvedValue({ data: [me] });
    apiClient.patch.mockResolvedValue({ data: { ...me, analytics_enabled: true } });
    const store = renderAt("/admin", me, [<Route key="a" path="/admin" element={<AdminUsersPage />} />]);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Analytics for admin@example.com" }), "on");
    await waitFor(() => expect(store.getState().auth.user.analytics_enabled).toBe(true));
  });
});
