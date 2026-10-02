/**
 * The cities a day on the timeline passes through, in order — for the day
 * row's "Bern → Wengen". Derived from the day's places, never stored.
 */

const US_STATE = /^[A-Z]{2}$/;

/** "3011 Bern" -> "Bern", "London SW1A 2AA" -> "London": drop postal-code tokens. */
function withoutPostcode(part) {
  return part
    .split(/\s+/)
    .filter((token) => !/\d/.test(token))
    .join(" ");
}

/**
 * A location's city: the one Google gave when it was picked, else a cautious
 * guess from its address ("street, [postcode] city, country"). Null when
 * there's nothing to judge by — a bare name says nothing reliable.
 */
export function cityOf(location) {
  if (!location) return null;
  if (location.city?.trim()) return location.city.trim();
  const parts = (location.address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  let guess = withoutPostcode(parts[parts.length - 2]);
  // "Springfield, IL 62704, USA": that part is the state; the city is before it.
  if ((US_STATE.test(guess) || !guess) && parts.length >= 3) {
    guess = withoutPostcode(parts[parts.length - 3]);
  }
  return guess && !US_STATE.test(guess) ? guess : null;
}

function placesOf(entry) {
  if (entry.kind === "activity") return [entry.item.location];
  if (entry.kind === "stay") return [entry.stay.location];
  if (entry.phase === "arrive") return [entry.travel.to];
  return [entry.travel.from, entry.travel.to];
}

/** A timeline row's cities in entry order, with repeats in a row merged. */
export function dayCities(row) {
  const cities = [];
  row.entries.forEach((entry) => {
    placesOf(entry).forEach((place) => {
      const city = cityOf(place);
      if (city && city !== cities[cities.length - 1]) cities.push(city);
    });
  });
  return cities;
}
