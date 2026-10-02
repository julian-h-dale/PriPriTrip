import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/features/timeline/buildTimeline";
// The same sample document the API seeds and tests with.
import sampleTrip from "../../../../api/app/sample_data/sample_trip.json";

/** One short label per entry, so whole days compare at a glance. */
function labels(row) {
  return row.entries.map((e) => {
    if (e.kind === "activity") return e.item.title;
    if (e.kind === "stay") return `${e.phase}: ${e.stay.name}`;
    return `${e.phase}: ${e.travel.title}`;
  });
}

function row(timeline, date) {
  return timeline.find((r) => r.date === date);
}

describe("buildTimeline", () => {
  const timeline = buildTimeline(sampleTrip);

  it("gives every trip date a row, including dates with no day entry", () => {
    expect(timeline.map((r) => r.date)).toEqual([
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
    ]);
    expect(row(timeline, "2026-05-10").title).toBeNull();
    expect(row(timeline, "2026-05-11").title).toBe("Arrive in Bern");
  });

  it("shows an overnight cross-zone flight on both dates", () => {
    expect(labels(row(timeline, "2026-05-10"))).toEqual(["depart: Chicago → Zürich"]);
    expect(labels(row(timeline, "2026-05-11"))[0]).toBe("arrive: Chicago → Zürich");
  });

  it("merges markers by time around activities in document order", () => {
    expect(labels(row(timeline, "2026-05-11"))).toEqual([
      "arrive: Chicago → Zürich", // 09:25
      "depart: Zürich Airport → Bern", // 10:28
      "Lunch at Altes Tramdepot", // 12:15
      "Old Town & Zytglogge walk", // untimed: stays after lunch
      "check-in: Hotel Goldener Schlüssel", // 14:00
      "Dinner at Kornhauskeller", // 19:00
    ]);
    expect(labels(row(timeline, "2026-05-12"))).toEqual([
      "Morning at the Rose Garden", // 08:30
      "check-out: Hotel Goldener Schlüssel", // 10:00
      "depart: Bern → Wengen", // 10:34
      "check-in: Beausite Park Hotel", // 15:00
      "Dinner at the hotel", // 19:00
      "Stargazing from the balcony", // untimed
    ]);
  });

  it("puts a multi-night stay's markers on the right dates", () => {
    expect(labels(row(timeline, "2026-05-13"))).toEqual([
      "staying: Beausite Park Hotel",
      "Männlichen → Kleine Scheidegg hike",
      "Lunch at Kleine Scheidegg",
      "Fondue night",
    ]);
    expect(labels(row(timeline, "2026-05-14"))).toEqual([
      "check-out: Beausite Park Hotel", // 10:00
      "depart: Zürich → Chicago", // same-day arrival: one entry
    ]);
  });

  it("leaves a date with nothing on it empty", () => {
    const rows = buildTimeline({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      stays: [],
      travels: [],
      days: [{ date: "2026-06-02", title: "Middle", items: [] }],
    });
    expect(rows.map((r) => [r.date, r.title, r.entries.length])).toEqual([
      ["2026-06-01", null, 0],
      ["2026-06-02", "Middle", 0],
      ["2026-06-03", null, 0],
    ]);
  });

  it("adds the day after the trip only when a check-out or arrival lands there", () => {
    const rows = buildTimeline({
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      stays: [{ name: "Inn", checkIn: "2026-06-01T15:00", checkOut: "2026-06-03T11:00" }],
      travels: [],
      days: [],
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(rows[2].afterTrip).toBe(true);
    expect(labels(rows[1])).toEqual(["staying: Inn"]);
    expect(labels(rows[2])).toEqual(["check-out: Inn"]);
  });

  it("orders same-time markers check-out, depart, arrive, check-in", () => {
    const rows = buildTimeline({
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      stays: [
        { name: "B", checkIn: "2026-06-02T11:00", checkOut: "2026-06-03T10:00" },
        { name: "A", checkIn: "2026-06-01T15:00", checkOut: "2026-06-02T11:00" },
      ],
      travels: [{ title: "Bus", mode: "bus", depart: "2026-06-02T11:00" }],
      days: [],
    });
    expect(labels(rows[1])).toEqual(["check-out: A", "depart: Bus", "check-in: B"]);
  });
});
