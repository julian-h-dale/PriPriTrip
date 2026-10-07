import { describe, expect, it } from "vitest";
import reducer, { dismiss, notify } from "@/shared/notificationSlice";

describe("notifications", () => {
  it("the same toast already showing isn't added twice", () => {
    let state = reducer(undefined, notify({ type: "warning", message: "Saved on this phone" }));
    state = reducer(state, notify({ type: "warning", message: "Saved on this phone" }));
    expect(state.items).toHaveLength(1);
    // A different one, or the same once it's gone, shows.
    state = reducer(state, notify({ type: "success", message: "Saved on this phone" }));
    expect(state.items).toHaveLength(2);
    state = reducer(state, dismiss(state.items[0].id));
    state = reducer(state, notify({ type: "warning", message: "Saved on this phone" }));
    expect(state.items.map((n) => n.type)).toEqual(["success", "warning"]);
  });
});
