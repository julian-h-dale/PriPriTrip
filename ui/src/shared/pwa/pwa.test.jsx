import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isIos, isStandalone, useInstallPrompt } from "@/shared/pwa/useInstallPrompt";
import { UpdatePrompt } from "@/shared/pwa/UpdatePrompt";

const fakeWindow = ({ standalone = false, ua = "Mozilla/5.0 (Linux; Android 14)", touch = 0 } = {}) => ({
  matchMedia: () => ({ matches: standalone }),
  navigator: { userAgent: ua, maxTouchPoints: touch, standalone: false },
});

describe("install detection", () => {
  it("knows when it's already the installed app", () => {
    expect(isStandalone(fakeWindow({ standalone: true }))).toBe(true);
    expect(isStandalone(fakeWindow())).toBe(false);
  });

  it("recognises iPhone and iPad (which reports itself as a Mac)", () => {
    expect(isIos(fakeWindow({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }))).toBe(true);
    expect(isIos(fakeWindow({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", touch: 5 }))).toBe(true);
    expect(isIos(fakeWindow({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", touch: 0 }))).toBe(false);
  });
});

describe("useInstallPrompt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers the browser's prompt once beforeinstallprompt fires, and uses it once", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBeNull(); // jsdom: not iOS, no prompt yet

    const event = new Event("beforeinstallprompt");
    event.prompt = vi.fn();
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    act(() => window.dispatchEvent(event));
    expect(result.current.mode).toBe("prompt");

    await act(() => result.current.install());
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBeNull();
  });

  it("hides once the app is installed", () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = new Event("beforeinstallprompt");
    event.prompt = vi.fn();
    act(() => window.dispatchEvent(event));
    act(() => window.dispatchEvent(new Event("appinstalled")));
    expect(result.current.mode).toBeNull();
  });
});

describe("UpdatePrompt", () => {
  it("shows only when an update is waiting, and reloads only when asked", async () => {
    const onReload = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(<UpdatePrompt needRefresh={false} onReload={onReload} onDismiss={onDismiss} />);
    expect(screen.queryByText("Update available")).not.toBeInTheDocument();

    rerender(<UpdatePrompt needRefresh onReload={onReload} onDismiss={onDismiss} />);
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(onReload).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
