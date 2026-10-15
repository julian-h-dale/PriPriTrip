import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNow } from "@/shared/hooks/useNow";

afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  it("moves on every interval, so a page keeps up without a reload", () => {
    vi.useFakeTimers({ now: new Date("2026-05-11T09:30:00Z") });
    const { result, unmount } = renderHook(() => useNow(60_000));
    expect(result.current).toBe(Date.parse("2026-05-11T09:30:00Z"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(Date.parse("2026-05-11T09:31:00Z"));
    unmount();
    expect(vi.getTimerCount()).toBe(0); // the timer stops with the page
  });
});
