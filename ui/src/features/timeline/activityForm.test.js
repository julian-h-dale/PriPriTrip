import { describe, expect, it } from "vitest";
import {
  endRollsOver,
  mapServerErrors,
  toFormValues,
  toPayload,
  validate,
} from "@/features/timeline/activityForm";

const DINNER = {
  id: "i1",
  title: "Dinner at Kornhauskeller",
  start: "2026-05-11T19:00",
  end: "2026-05-11T21:00",
  timezone: "Europe/Bern",
  zone: "Europe/Zurich", // read-only, from the server; never sent back
  location: {
    name: "Kornhauskeller",
    address: "Kornhausplatz 18",
    lat: 46.9493,
    lng: 7.4466,
    placeId: "ChIJk",
    url: "https://www.kornhaus-bern.ch",
  },
  confirmationNumber: "Table for 2",
  notes: "**Book ahead**",
};

describe("activity form helpers", () => {
  it("round-trips an unchanged activity", () => {
    const values = toFormValues(DINNER, "2026-05-11");
    expect(values.startTime).toBe("19:00");
    expect(values.place).toEqual({
      name: "Kornhauskeller",
      address: "Kornhausplatz 18",
      lat: 46.9493,
      lng: 7.4466,
      placeId: "ChIJk",
    });
    const expected = { ...DINNER, date: "2026-05-11" };
    delete expected.id; // the API body never carries an id...
    delete expected.zone; // ...or a computed zone
    expect(toPayload(values, DINNER)).toEqual(expected);
  });

  it("starts a blank activity on the given day", () => {
    const values = toFormValues(null, "2026-05-12");
    expect(values.date).toBe("2026-05-12");
    expect(toPayload({ ...values, title: " Nap " }, null)).toEqual({
      date: "2026-05-12",
      title: "Nap",
    });
  });

  it("rolls an end time before the start over to the next day", () => {
    const values = {
      ...toFormValues(null, "2026-05-11"),
      title: "Late show",
      startTime: "22:00",
      endTime: "01:00",
    };
    expect(endRollsOver(values)).toBe(true);
    expect(toPayload(values, null)).toMatchObject({
      start: "2026-05-11T22:00",
      end: "2026-05-12T01:00",
    });
  });

  it("moves times with the day when the day changes", () => {
    const values = { ...toFormValues(DINNER, "2026-05-11"), date: "2026-05-13" };
    expect(toPayload(values, DINNER)).toMatchObject({
      date: "2026-05-13",
      start: "2026-05-13T19:00",
      end: "2026-05-13T21:00",
    });
  });

  it("keeps a picked place's coordinates when it is renamed", () => {
    const values = toFormValues(DINNER, "2026-05-11");
    values.place = { ...values.place, name: "Kornhaus (cellar)" };
    expect(toPayload(values, DINNER).location).toMatchObject({
      name: "Kornhaus (cellar)",
      lat: 46.9493,
      placeId: "ChIJk",
    });
  });

  it("clears fields the user emptied", () => {
    const values = {
      ...toFormValues(DINNER, "2026-05-11"),
      endTime: "",
      place: null,
      locationUrl: "",
      confirmationNumber: "",
      notes: "  ",
    };
    expect(toPayload(values, DINNER)).toEqual({
      date: "2026-05-11",
      title: "Dinner at Kornhauskeller",
      start: "2026-05-11T19:00",
      timezone: "Europe/Bern",
    });
  });

  it("checks the obvious things before saving", () => {
    const blank = toFormValues(null, "2026-05-11");
    expect(validate(blank)).toEqual({ title: "Give the activity a title" });
    expect(
      validate({ ...blank, title: "x", locationUrl: "https://x.ch", endTime: "10:00" })
    ).toEqual({
      locationUrl: "Pick a place to add a link",
      endTime: "Add a start time first",
    });
    expect(validate({ ...blank, title: "x", place: { name: " ", lat: 1, lng: 2 } })).toEqual({
      place: "Give the place a name",
    });
  });

  it("maps server error paths to fields", () => {
    const { fields, other } = mapServerErrors([
      { path: "end", message: "must be after start" },
      { path: "location.url", message: "String should match pattern" },
      { path: "location.lat", message: "too big" },
      { path: "mystery", message: "huh" },
    ]);
    expect(fields).toEqual({
      endTime: "must be after start",
      locationUrl: "String should match pattern",
      place: "too big",
    });
    expect(other).toEqual([{ path: "mystery", message: "huh" }]);
  });
});
