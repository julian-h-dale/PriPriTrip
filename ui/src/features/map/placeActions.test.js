import { describe, it, expect } from "vitest";
import { isArea, placeActions } from "@/features/map/placeActions";

describe("placeActions", () => {
  it("lodging: stay first, then activity; travel under More", () => {
    expect(placeActions(["hotel", "lodging", "point_of_interest", "establishment"])).toEqual({
      primary: ["stay", "activity"],
      more: ["poi", "travelFrom", "travelTo"],
    });
  });

  it("airports and train stations: travel from/to first, then activity; stay under More", () => {
    for (const types of [["international_airport", "airport"], ["train_station", "transit_station"]]) {
      expect(placeActions(types)).toEqual({
        primary: ["travelFrom", "travelTo", "activity"],
        more: ["poi", "stay"],
      });
    }
  });

  it("a city or region offers nothing (the map just pans there)", () => {
    expect(placeActions(["locality", "political"])).toEqual({ primary: [], more: [] });
    expect(placeActions(["country", "political"])).toEqual({ primary: [], more: [] });
    expect(isArea(["locality", "political"])).toBe(true);
  });

  it("a shop, market, café or sight: point of interest first, then activity", () => {
    for (const types of [
      ["restaurant", "food", "establishment"],
      ["clothing_store", "store"],
      ["market", "establishment"],
      ["museum", "tourist_attraction"],
    ]) {
      expect(placeActions(types)).toEqual({
        primary: ["poi", "activity"],
        more: ["stay", "travelFrom", "travelTo"],
      });
    }
  });

  it("anything else: activity, with the rest (point of interest too) under More", () => {
    expect(placeActions(["dentist", "health", "establishment"])).toEqual({
      primary: ["activity"],
      more: ["poi", "stay", "travelFrom", "travelTo"],
    });
  });

  it("unknown or missing types behave like a venue", () => {
    expect(placeActions([]).primary).toEqual(["activity"]);
    expect(placeActions(undefined).primary).toEqual(["activity"]);
    expect(isArea([])).toBe(false);
  });
});
