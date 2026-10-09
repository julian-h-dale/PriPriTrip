import { describe, it, expect } from "vitest";
import { authorKey, authorStyles } from "@/features/journal/authorColors";

const m = (extra) => ({ id: Math.random().toString(), mine: false, authorEmail: "x@example.com", authorName: "", ...extra });

describe("authorStyles", () => {
  it("colors people in the trip's order: owner first, then members as they joined", () => {
    const styles = authorStyles(
      [
        m({ authorEmail: "sam@example.com", authorRank: 2 }),
        m({ mine: true, authorEmail: "me@example.com", authorName: "Julian", authorRank: 1 }),
        m({ authorEmail: "pripri@example.com", authorName: "PriPri", authorRank: 0 }),
      ],
      { role: "editor" }
    );
    expect([...styles.entries()].map(([key, s]) => [key, s.label, s.dot])).toEqual([
      ["pripri@example.com", "PriPri", "bg-series-1"],
      ["me", "You", "bg-series-2"],
      ["sam@example.com", "sam@example.com", "bg-series-3"], // no name: the email
    ]);
    expect(styles.get("me").edge).toBe("border-l-series-2");
    expect(styles.get("me").tint).toBe("bg-series-2/10");
  });

  it("a memory of yours still on the phone takes your color", () => {
    const owner = authorStyles([m({ mine: true, pending: true })], { role: "owner" });
    expect(owner.get("me").dot).toBe("bg-series-1");
    const member = authorStyles(
      [m({ mine: true, pending: true }), m({ mine: true, authorRank: 3 }), m({ authorEmail: "o@x.com", authorRank: 0 })],
      { role: "editor" }
    );
    expect(member.get("me").dot).toBe("bg-series-4");
    const first = authorStyles([m({ mine: true, pending: true }), m({ authorEmail: "o@x.com", authorRank: 0 })], {
      role: "editor",
    });
    expect(first.get("me").dot).toBe("bg-series-2"); // the next free one
  });

  it("wraps after eight people", () => {
    expect(authorStyles([m({ authorRank: 9 })], {}).get("x@example.com").dot).toBe("bg-series-2");
  });

  it("keys your own memories together, others by email", () => {
    expect(authorKey({ mine: true, authorEmail: "a" })).toBe("me");
    expect(authorKey({ mine: false, authorEmail: "a" })).toBe("a");
  });
});
