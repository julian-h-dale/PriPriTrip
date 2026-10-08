import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/auth/authSlice";
import journalReducer from "@/features/journal/journalSlice";
import timelineReducer from "@/features/timeline/timelineSlice";
import networkReducer from "@/shared/networkSlice";
import errorReducer from "@/shared/errorSlice";
import notificationReducer from "@/shared/notificationSlice";
import { TopBar } from "@/shared/components/TopBar";
import { setTheme } from "@/shared/theme";
import { setTextSize } from "@/shared/textSize";
import { fakeToken } from "@/test/fakeToken";

vi.mock("@/shared/services/apiClient", () => ({ apiClient: { get: vi.fn(async () => ({ data: [] })) } }));

async function openDrawer(path) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      journal: journalReducer,
      timeline: timelineReducer,
      network: networkReducer,
      error: errorReducer,
      notification: notificationReducer,
    },
    preloadedState: { auth: { token: fakeToken("user-1"), user: { email: "u@x.com" }, status: "idle" } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TopBar title="x" />
      </MemoryRouter>
    </Provider>
  );
  await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
  return screen.getByRole("navigation", { name: "Menu" });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "dark";
  document.head.innerHTML = '<meta name="theme-color" content="#12151c">';
});
afterEach(() => {
  setTheme("dark");
  setTextSize("normal");
});

describe("light mode (Run stage 22)", () => {
  it("is a switch in the All trips drawer, off: dark is the default", async () => {
    const menu = await openDrawer("/trips");
    const toggle = within(menu).getByRole("switch", { name: "Light mode" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Easier to read in bright sun.");
  });

  it("isn't in a trip's drawer", async () => {
    const menu = await openDrawer("/trips/trip-1");
    expect(within(menu).queryByRole("switch", { name: "Light mode" })).toBeNull();
  });

  it("switches the colours and the status bar, and is remembered on this phone", async () => {
    const menu = await openDrawer("/trips");
    await userEvent.click(within(menu).getByRole("switch", { name: "Light mode" }));
    const html = document.documentElement;
    expect(html).toHaveClass("light");
    expect(html).not.toHaveClass("dark");
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#f8f9fb");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(within(menu).getByRole("switch", { name: "Light mode" })).toHaveAttribute("aria-checked", "true");

    await userEvent.click(within(menu).getByRole("switch", { name: "Light mode" }));
    expect(html).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBeNull();
  });
});

describe("text size (Run stage 22)", () => {
  it("is beside Light mode in the All trips drawer: Normal, Large, Larger", async () => {
    const menu = await openDrawer("/trips");
    const sizes = within(menu).getByRole("radiogroup", { name: "Text size" });
    expect(within(sizes).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Normal", "Large", "Larger"]);
    expect(within(sizes).getByRole("radio", { name: "Normal" })).toHaveAttribute("aria-checked", "true");
  });

  it("sets the root size, so everything in rem grows with it, and is remembered", async () => {
    const menu = await openDrawer("/trips");
    await userEvent.click(within(menu).getByRole("radio", { name: "Larger" }));
    expect(document.documentElement.style.fontSize).toBe("125%");
    expect(localStorage.getItem("textSize")).toBe("larger");
    expect(within(menu).getByRole("radio", { name: "Larger" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(menu).getByRole("radio", { name: "Normal" }));
    expect(document.documentElement.style.fontSize).toBe("");
    expect(localStorage.getItem("textSize")).toBeNull();
  });

  it("isn't in a trip's drawer", async () => {
    const menu = await openDrawer("/trips/trip-1");
    expect(within(menu).queryByRole("radiogroup", { name: "Text size" })).toBeNull();
  });
});
