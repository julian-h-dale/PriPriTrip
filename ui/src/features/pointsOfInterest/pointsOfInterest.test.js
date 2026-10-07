import { describe, expect, it } from "vitest";
import { categoryFor, poiPayload, toPoiValues, validatePoi } from "@/features/pointsOfInterest/pointsOfInterest";

const MARKET = { name: "Bundesplatz market", address: "Bundesplatz, Bern", lat: 46.9467, lng: 7.4442, placeId: "ChIJm" };

describe("a point of interest's category, guessed from Google's types", () => {
  it("a market before a shop (Google often calls a market a store too)", () => {
    expect(categoryFor(["market", "store"])).toBe("market");
    expect(categoryFor(["farmers_market"])).toBe("market");
  });

  it("food before shops: a coffee shop or bakery is food", () => {
    expect(categoryFor(["coffee_shop", "store"])).toBe("food");
    expect(categoryFor(["bakery", "store"])).toBe("food");
    expect(categoryFor(["swiss_restaurant"])).toBe("food");
  });

  it("shops, sights, and the rest", () => {
    expect(categoryFor(["book_store", "store"])).toBe("shop");
    expect(categoryFor(["shopping_mall"])).toBe("shop");
    expect(categoryFor(["museum", "tourist_attraction"])).toBe("sight");
    expect(categoryFor(["church", "place_of_worship"])).toBe("sight");
    expect(categoryFor(["dentist"])).toBe("other");
    expect(categoryFor(undefined)).toBe("other");
  });
});

describe("the form's values", () => {
  it("a new one starts from the picked place, named after it, its kind guessed", () => {
    expect(toPoiValues(null, { place: MARKET, types: ["market"] })).toMatchObject({
      name: "Bundesplatz market",
      category: "market",
      place: MARKET,
      notes: "",
    });
  });

  it("an existing one, as saved", () => {
    const poi = { id: "p1", name: "Loeb", category: "shop", location: { ...MARKET, url: "https://loeb.ch" }, notes: "Sale" };
    const values = toPoiValues(poi);
    expect(values).toMatchObject({ name: "Loeb", category: "shop", locationUrl: "https://loeb.ch", notes: "Sale" });
    expect(values.place.url).toBeUndefined();
  });

  it("the payload: trimmed, the link inside the location, no empty notes", () => {
    const payload = poiPayload({ name: " Loeb ", category: "shop", place: MARKET, locationUrl: " https://loeb.ch ", notes: "  " });
    expect(payload).toEqual({ name: "Loeb", category: "shop", location: { ...MARKET, url: "https://loeb.ch" } });
  });

  it("needs a name and a place on the map", () => {
    expect(validatePoi({ name: "", place: null })).toEqual({ name: "Name it", place: "Pick where it is" });
    expect(validatePoi({ name: "x", place: { name: "Typed by hand" } }).place).toMatch(/spot on the map/);
    expect(validatePoi({ name: "x", place: MARKET })).toEqual({});
  });
});
