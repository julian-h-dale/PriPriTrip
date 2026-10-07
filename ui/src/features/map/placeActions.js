import { categoryFor } from "@/features/pointsOfInterest/pointsOfInterest";

/**
 * Which "Add" actions to offer for a place picked from Google search, from
 * its Google place types. Relevant ones first (`primary`); the rest stay one
 * "More…" away (`more`) in case Google's types are off — a ryokan typed as a
 * restaurant, say. A city or region offers nothing: the map just pans there.
 *
 * Actions: "stay" | "activity" | "travelFrom" | "travelTo" | "poi" (save
 * it as a point of interest: first for a shop, market, café or sight).
 */


const LODGING = new Set([
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "resort_hotel",
  "inn",
  "bed_and_breakfast",
  "guest_house",
  "campground",
  "camping_cabin",
  "cottage",
  "extended_stay_hotel",
  "farmstay",
  "japanese_inn",
  "budget_japanese_inn",
  "private_guest_room",
  "rv_park",
]);

const TRANSIT_HUB = new Set([
  "airport",
  "international_airport",
  "train_station",
  "bus_station",
  "transit_station",
  "subway_station",
  "light_rail_station",
  "ferry_terminal",
]);

const AREA = new Set([
  "locality",
  "sublocality",
  "postal_town",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "political",
  "colloquial_area",
  "neighborhood",
  "archipelago",
  "continent",
  "geocode",
]);

const ALL = ["activity", "poi", "stay", "travelFrom", "travelTo"];

function split(primary) {
  return { primary, more: ALL.filter((a) => !primary.includes(a)) };
}

/** True when every type is an area (a city, region, country…), not a venue. */
export function isArea(types = []) {
  return types.length > 0 && types.every((t) => AREA.has(t));
}

export function placeActions(types = []) {
  if (isArea(types)) return { primary: [], more: [] };
  if (types.some((t) => LODGING.has(t))) return split(["stay", "activity"]);
  if (types.some((t) => TRANSIT_HUB.has(t))) return split(["travelFrom", "travelTo", "activity"]);
  // Somewhere to wander into rather than book: a point of interest first.
  if (categoryFor(types) !== "other") return split(["poi", "activity"]);
  return split(["activity"]);
}

export const ACTION_LABEL = {
  activity: "Add activity",
  stay: "Add stay",
  travelFrom: "Travel from here",
  travelTo: "Travel to here",
  poi: "Point of interest",
};
