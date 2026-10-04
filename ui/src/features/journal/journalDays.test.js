import { describe, it, expect } from "vitest";
import { journalDays, memoryDate, memoryTime } from "@/features/journal/journalDays";

const TRIP = { startDate: "2026-10-29", endDate: "2026-11-13", timezone: "Asia/Tokyo" };
const m = (id, createdAt, zone) => ({ id, createdAt, zone, text: id });

describe("memoryDate and memoryTime", () => {
  it("use the zone it was written in, across midnight and the date line", () => {
    // 15:30Z on Oct 29 is 00:30 on Oct 30 in Tokyo, still Oct 29 in Chicago.
    expect(memoryDate(m("a", "2026-10-29T15:30:00Z", "Asia/Tokyo"))).toBe("2026-10-30");
    expect(memoryDate(m("b", "2026-10-29T15:30:00Z", "America/Chicago"))).toBe("2026-10-29");
    expect(memoryTime(m("a", "2026-10-29T15:30:00Z", "Asia/Tokyo"))).toBe("12:30 AM");
    expect(memoryTime(m("b", "2026-10-29T15:30:00Z", "America/Chicago"))).toBe("10:30 AM");
  });
});

describe("journalDays", () => {
  it("groups by local date in trip order, keeping server order inside a day", () => {
    const memories = [
      m("first", "2026-10-30T01:00:00Z", "Asia/Tokyo"), // Oct 30, 10:00 Tokyo
      m("second", "2026-10-30T02:00:00Z", "America/Chicago"), // Oct 29, 21:00 Chicago
      m("third", "2026-10-30T03:00:00Z", "Asia/Tokyo"), // Oct 30, 12:00 Tokyo
    ];
    const groups = journalDays(memories, TRIP);
    expect(groups.map((g) => [g.date, g.memories.map((x) => x.id)])).toEqual([
      ["2026-10-29", ["second"]],
      ["2026-10-30", ["first", "third"]],
    ]);
  });

  it("puts memories outside the trip's dates before and after", () => {
    const groups = journalDays(
      [
        m("packing", "2026-10-20T12:00:00Z", "America/Chicago"),
        m("day1", "2026-10-29T12:00:00Z", "Asia/Tokyo"),
        m("home", "2026-11-20T12:00:00Z", "America/Chicago"),
      ],
      TRIP
    );
    expect(groups.map((g) => g.kind)).toEqual(["before", "day", "after"]);
  });

  it("is empty with no memories", () => {
    expect(journalDays([], TRIP)).toEqual([]);
  });
});
