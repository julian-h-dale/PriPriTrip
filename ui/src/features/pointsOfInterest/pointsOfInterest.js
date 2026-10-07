import { Landmark, MapPinned, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
import { compact, locationFrom, placeOf } from "@/features/timeline/activityForm";

/**
 * Points of interest (Run stage 16): shops, markets and sights worth finding,
 * kept with the trip but on no day, so they show on the map only. Always
 * "point of interest" (`poi` for short in code), never "place": a place is a
 * Google result or an entry's location.
 */

/** Each category: [value, label]. The order of the form's choices. */
export const POI_CATEGORIES = [
  ["shop", "Shop"],
  ["market", "Market"],
  ["food", "Food & drink"],
  ["sight", "Sight"],
  ["other", "Other"],
];

export const POI_CATEGORY_LABEL = Object.fromEntries(POI_CATEGORIES);

/** A category's icon, on its pin and in lists (the pin's glyph is the same shape, mapStyle.js). */
export const POI_ICON = {
  shop: ShoppingBag,
  market: Store,
  food: UtensilsCrossed,
  sight: Landmark,
  other: MapPinned,
};

const MARKET = new Set(["market", "farmers_market", "flea_market"]);
const FOOD = new Set([
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "pub",
  "wine_bar",
  "food",
  "meal_takeaway",
  "ice_cream_shop",
  "dessert_shop",
  "confectionery",
  "chocolate_shop",
  "tea_house",
]);
const SIGHT = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "church",
  "place_of_worship",
  "historical_landmark",
  "historical_place",
  "monument",
  "cultural_landmark",
  "castle",
  "garden",
  "zoo",
  "aquarium",
  "national_park",
  "observation_deck",
  "plaza",
]);

const isShop = (t) =>
  t === "store" || t.endsWith("_store") || t === "shopping_mall" || t === "gift_shop" || t === "supermarket";

/**
 * The category a Google place most likely is, from its types, or "other".
 * A market first (Google often also calls it a store), then food (a "shop"
 * that sells coffee is a café), then shops, then sights.
 */
export function categoryFor(types = []) {
  if (types.some((t) => MARKET.has(t))) return "market";
  if (types.some((t) => FOOD.has(t) || t.endsWith("_restaurant"))) return "food";
  if (types.some(isShop)) return "shop";
  if (types.some((t) => SIGHT.has(t))) return "sight";
  return "other";
}

/** Form state for an existing point of interest, or a new one from a picked Google place. */
export function toPoiValues(poi, prefill) {
  return {
    name: poi?.name ?? (prefill?.place?.name || ""),
    category: poi?.category ?? categoryFor(prefill?.types),
    place: poi ? placeOf(poi.location) : (prefill?.place ?? null),
    locationUrl: poi?.location?.url ?? "",
    notes: poi?.notes ?? "",
  };
}

export function poiPayload(values) {
  return compact({
    name: values.name.trim(),
    category: values.category,
    location: locationFrom(values.place, values.locationUrl),
    notes: values.notes.trim() ? values.notes : null,
  });
}

export function validatePoi(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "Name it";
  if (!values.place) errors.place = "Pick where it is";
  else if (values.place.lat == null || values.place.lng == null) {
    errors.place = "Pick it from the search, so it has a spot on the map";
  } else if (!values.place.name.trim()) errors.place = "Give the place a name";
  return errors;
}

/** The server's error paths, onto the form's fields. */
export const POI_PATHS = {
  name: "name",
  category: "category",
  location: "place",
  "location.name": "place",
  "location.url": "locationUrl",
  notes: "notes",
};
