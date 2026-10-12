import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { isDone } from "@/features/timeline/entryDone";

// Athens, with a flight home to Chicago (two clocks): Athens is UTC+3 and
// Chicago UTC−5 in October.
const TRIP = {
  id: "t",
  name: "Athens",
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  timezone: "Europe/Athens",
  stays: [{ name: "Hotel Plaka", checkIn: "2026-10-10T15:00", checkOut: "2026-10-12T11:00" }],
  travels: [
    {
      mode: "flight",
      title: "ATH → ORD",
      depart: "2026-10-12T13:00",
      arrive: "2026-10-12T17:30",
      arriveTimezone: "America/Chicago",
    },
  ],
  days: [
    {
      date: "2026-10-11",
      items: [
        { title: "Acropolis", start: "2026-10-11T09:00", end: "2026-10-11T11:00" },
        { title: "Dinner", start: "2026-10-11T20:00" },
        { title: "Wander Plaka" },
      ],
    },
  ],
};

const rows = buildTimeline(TRIP);
/** The entry on `date` whose title (or a booking's name) contains `text`. */
function find(date, text) {
  const row = rows.find((r) => r.date === date);
  const entry = row.entries.find((e) =>
    [e.item?.title, e.stay?.name, e.travel?.title].some((t) => t?.includes(text))
  );
  if (!entry) throw new Error(`no ${text} on ${date}`);
  return entry;
}
const at = (iso) => new Date(iso).getTime();
const done = (date, text, iso, phase) => {
  const row = rows.find((r) => r.date === date);
  const entry = phase ? row.entries.find((e) => e.phase === phase) : find(date, text);
  return isDone(entry, date, TRIP, at(iso));
};

describe("isDone (Run stage 30)", () => {
  it("the Athens check-out: done once 11:00 in Athens has passed", () => {
    expect(done("2026-10-12", null, "2026-10-12T07:59:00Z", "check-out")).toBe(false); // 10:59 Athens
    expect(done("2026-10-12", null, "2026-10-12T08:30:00Z", "check-out")).toBe(true); // 11:30 Athens
  });

  it("an activity with an end is done at its end; with only a start, as it starts", () => {
    expect(done("2026-10-11", "Acropolis", "2026-10-11T07:00:00Z")).toBe(false); // 10:00, under way
    expect(done("2026-10-11", "Acropolis", "2026-10-11T08:01:00Z")).toBe(true); // 11:01
    expect(done("2026-10-11", "Dinner", "2026-10-11T16:59:00Z")).toBe(false); // 19:59
    expect(done("2026-10-11", "Dinner", "2026-10-11T17:01:00Z")).toBe(true); // 20:01
  });

  it("exactly at its time it isn't done yet (\"Next up\" still shows it)", () => {
    expect(done("2026-10-11", "Dinner", "2026-10-11T17:00:00Z")).toBe(false);
  });

  it("a same-day flight is done when it lands, on the landing city's clock", () => {
    // Lands 17:30 in Chicago = 22:30 UTC, already 01:30 the next day in
    // Athens: still in the air until then, whatever the trip's calendar says.
    expect(done("2026-10-12", "ATH → ORD", "2026-10-12T22:29:00Z")).toBe(false);
    expect(done("2026-10-12", "ATH → ORD", "2026-10-12T22:31:00Z")).toBe(true);
  });

  it("an untimed activity stays bright all day, and is done once the day is over", () => {
    expect(done("2026-10-11", "Wander", "2026-10-11T20:59:00Z")).toBe(false); // 23:59 Athens
    expect(done("2026-10-11", "Wander", "2026-10-11T21:01:00Z")).toBe(true); // 00:01 next day
  });

  it("an earlier day's entries are done: a timed one by its time, an untimed one by its day", () => {
    expect(done("2026-10-10", null, "2026-10-11T06:00:00Z", "check-in")).toBe(true);
    expect(done("2026-10-11", "Wander", "2026-10-12T06:00:00Z")).toBe(true);
  });

  it("\"Staying at\" fades only once its night's day is over", () => {
    expect(done("2026-10-11", null, "2026-10-11T20:00:00Z", "staying")).toBe(false);
    expect(done("2026-10-11", null, "2026-10-11T21:30:00Z", "staying")).toBe(true);
  });

  it("the phone's own zone doesn't matter: only the instant does", () => {
    // The same instant, whatever zone the phone is in: Date.getTime() has none.
    const chicagoMorning = new Date("2026-10-12T03:30:00-05:00").getTime(); // 11:30 Athens
    expect(isDone(rows.find((r) => r.date === "2026-10-12").entries.find((e) => e.phase === "check-out"), "2026-10-12", TRIP, chicagoMorning)).toBe(true);
  });
});
