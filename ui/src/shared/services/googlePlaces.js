import { loadGoogleMapsLibrary, GoogleMapsUnavailable } from "@/shared/services/googleMapsLoader";

/**
 * The one place that knows Google's Places API (the Maps JavaScript API's
 * `places` library). Everything else works with plain objects:
 *
 *   suggestion: { placeId, primary, secondary }
 *   place:      { placeId, name, address, city, lat, lng, imgRef }
 *
 * `pick()` also returns the place's Google `types` on the same object. A trip
 * location has no such field (the API rejects unknown ones), so anything that
 * stores the place drops `types` first.
 *
 * The browser key comes from GET /config. It is public by design and protected
 * by its restrictions in the Google console (our websites; Maps JavaScript +
 * Places APIs). The library is loaded only when a place field is first used.
 * Tests mock this module.
 */

export const PlacesUnavailable = GoogleMapsUnavailable;

/** The town a place is in: its locality, or the postal town (UK addresses). */
function cityComponent(components = []) {
  const find = (type) => components.find((c) => c.types.includes(type))?.longText;
  return find("locality") ?? find("postal_town") ?? undefined;
}

/**
 * A place search for one field. Suggestions and the final pick share a
 * session token, so Google bills a search-and-pick as one session rather than
 * per keystroke; a new session starts after each pick.
 */
export async function createPlacesSearch() {
  const places = await loadGoogleMapsLibrary("places");
  let sessionToken = new places.AutocompleteSessionToken();
  const predictions = new Map();

  return {
    /**
     * Suggestions for typed text, biased towards `near` if given: a point
     * ({ lat, lng }, within 50 km) or an area ({ north, south, east, west },
     * e.g. what the map is showing).
     */
    async suggest(input, near) {
      const request = { input, sessionToken };
      if (near?.north != null) request.locationBias = near;
      else if (near) request.locationBias = { center: near, radius: 50_000 };
      const { suggestions } =
        await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
      return suggestions
        .map((s) => s.placePrediction)
        .filter(Boolean)
        .map((p) => {
          predictions.set(p.placeId, p);
          return {
            placeId: p.placeId,
            primary: p.mainText?.text ?? p.text.text,
            secondary: p.secondaryText?.text ?? "",
          };
        });
    },

    /**
     * The chosen suggestion's details: name, address, city, coordinates and
     * its first photo — plus `types` (Google's place types), which callers
     * drop before storing the place.
     */
    async pick(suggestion) {
      const place = predictions.get(suggestion.placeId).toPlace();
      await place.fetchFields({
        fields: ["id", "displayName", "formattedAddress", "addressComponents", "location", "photos", "types"],
      });
      sessionToken = new places.AutocompleteSessionToken();
      return {
        placeId: place.id,
        name: place.displayName ?? suggestion.primary,
        address: place.formattedAddress ?? undefined,
        city: cityComponent(place.addressComponents),
        lat: place.location.lat(),
        lng: place.location.lng(),
        imgRef: place.photos?.[0]?.getURI({ maxWidth: 800 }) ?? undefined,
        types: place.types ?? [],
      };
    },
  };
}
