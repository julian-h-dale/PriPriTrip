import { getClientConfig } from "@/shared/services/clientConfig";

/**
 * The one place that knows Google's Places API (the Maps JavaScript API's
 * `places` library). Everything else works with plain objects:
 *
 *   suggestion: { placeId, primary, secondary }
 *   place:      { placeId, name, address, lat, lng }
 *
 * The browser key comes from GET /config. It is public by design and protected
 * by its restrictions in the Google console (our websites; Maps JavaScript +
 * Places APIs). The library is loaded only when a place field is first used.
 * Tests mock this module.
 */

export class PlacesUnavailable extends Error {}

let loading = null;

function loadPlacesLibrary(apiKey) {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const ready = () => window.google.maps.importLibrary("places").then(resolve, reject);
      if (window.google?.maps?.importLibrary) {
        ready();
        return;
      }
      const callback = "__pripritripMapsReady";
      window[callback] = ready;
      const script = document.createElement("script");
      script.src =
        "https://maps.googleapis.com/maps/api/js" +
        `?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
      script.async = true;
      script.onerror = () => {
        loading = null;
        reject(new PlacesUnavailable("Couldn’t load Google Maps"));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/**
 * A place search for one field. Suggestions and the final pick share a
 * session token, so Google bills a search-and-pick as one session rather than
 * per keystroke; a new session starts after each pick.
 */
export async function createPlacesSearch() {
  const { googleMapsApiKey } = await getClientConfig();
  if (!googleMapsApiKey) throw new PlacesUnavailable("No Google Maps key is configured");
  const places = await loadPlacesLibrary(googleMapsApiKey);
  let sessionToken = new places.AutocompleteSessionToken();
  const predictions = new Map();

  return {
    /** Suggestions for typed text, biased towards `near` ({ lat, lng }) if given. */
    async suggest(input, near) {
      const request = { input, sessionToken };
      if (near) request.locationBias = { center: near, radius: 50_000 };
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

    /** The chosen suggestion's details: name, address and coordinates. */
    async pick(suggestion) {
      const place = predictions.get(suggestion.placeId).toPlace();
      await place.fetchFields({ fields: ["id", "displayName", "formattedAddress", "location"] });
      sessionToken = new places.AutocompleteSessionToken();
      return {
        placeId: place.id,
        name: place.displayName ?? suggestion.primary,
        address: place.formattedAddress ?? undefined,
        lat: place.location.lat(),
        lng: place.location.lng(),
      };
    },
  };
}
