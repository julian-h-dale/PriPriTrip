import { describe, it, expect, vi } from "vitest";
import { createPlacesSearch, placeDetails } from "@/shared/services/googlePlaces";

// Google's Place, as the Places library gives it once its fields are fetched.
const GOOGLE_CAFE = {
  id: "cafe-1",
  displayName: "Café Fédéral",
  formattedAddress: "Bärenplatz 31, 3011 Bern",
  addressComponents: [{ types: ["locality", "political"], longText: "Bern" }],
  location: { lat: () => 46.947, lng: () => 7.443 },
  photos: [{ getURI: ({ maxWidth }) => `https://photos/cafe?w=${maxWidth}` }],
  types: ["cafe", "food"],
};

const fetched = vi.hoisted(() => ({ ids: [], fields: [] }));
vi.mock("@/shared/services/googleMapsLoader", () => {
  class Place {
    constructor({ id }) {
      fetched.ids.push(id);
    }
    async fetchFields({ fields }) {
      fetched.fields.push(fields);
      Object.assign(this, GOOGLE_CAFE);
    }
  }
  class AutocompleteSessionToken {}
  const AutocompleteSuggestion = {
    fetchAutocompleteSuggestions: async () => ({
      suggestions: [{ placePrediction: { placeId: "cafe-1", mainText: { text: "Café" }, text: { text: "Café" }, toPlace: () => new Place({ id: "cafe-1" }) } }],
    }),
  };
  return {
    loadGoogleMapsLibrary: vi.fn(async () => ({ Place, AutocompleteSessionToken, AutocompleteSuggestion })),
    GoogleMapsUnavailable: class extends Error {},
  };
});

const OUR_CAFE = {
  placeId: "cafe-1",
  name: "Café Fédéral",
  address: "Bärenplatz 31, 3011 Bern",
  city: "Bern",
  lat: 46.947,
  lng: 7.443,
  imgRef: "https://photos/cafe?w=800",
  types: ["cafe", "food"],
};

describe("placeDetails", () => {
  it("looks a place up by its id, as our plain place object", async () => {
    expect(await placeDetails("cafe-1")).toEqual(OUR_CAFE);
    expect(fetched.ids.at(-1)).toBe("cafe-1");
  });

  it("is the same object, from the same fields, as a search's pick()", async () => {
    const search = await createPlacesSearch();
    const [suggestion] = await search.suggest("Caf");
    const picked = await search.pick(suggestion);
    expect(await placeDetails("cafe-1")).toEqual(picked);
    expect(fetched.fields.at(-1)).toEqual(fetched.fields.at(-2));
  });
});
