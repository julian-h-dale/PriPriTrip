import { describe, it, expect } from "vitest";
import { searchRows } from "@/features/map/searchRows";

const hotel = { id: "stay-1", title: "Hotel Goldener Schlüssel", placeId: "gs-1" };
const lunch = { id: "item-1", title: "Lunch", placeId: null };

describe("searchRows", () => {
  it("puts every trip match before any Google suggestion", () => {
    const rows = searchRows([hotel], [{ placeId: "x", primary: "Café X", secondary: "Bern" }], [hotel, lunch]);
    expect(rows.map((r) => r.type)).toEqual(["trip", "place"]);
  });

  it("drops a Google suggestion the trip already has", () => {
    const rows = searchRows(
      [],
      [
        { placeId: "gs-1", primary: "Hotel Goldener Schlüssel", secondary: "Bern" },
        { placeId: "new-1", primary: "Hotel Bellevue", secondary: "Bern" },
      ],
      [hotel, lunch]
    );
    expect(rows.map((r) => r.suggestion.placeId)).toEqual(["new-1"]);
  });

  it("works with nothing from Google (offline or unavailable)", () => {
    expect(searchRows([hotel], [], [hotel])).toEqual([{ type: "trip", key: "trip:stay-1", marker: hotel }]);
  });
});
