/**
 * Google Places API (New) — Autocomplete service.
 * Keeps all Maps API calls isolated from the app's own backend client.
 */

const AUTOCOMPLETE_URL =
  'https://places.googleapis.com/v1/places:autocomplete';

/**
 * Fetch place autocomplete suggestions for a text input.
 *
 * @param {string} input   — user's typed text
 * @param {string} apiKey  — Google Maps API key from auth
 * @returns {Promise<Array>} array of suggestion objects:
 *   { placeId, description, mainText, groupLabel }
 */
export async function fetchPlaceSuggestions(input, apiKey) {
  if (!input || !apiKey) return [];

  const res = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify({ input }),
  });

  if (!res.ok) {
    console.error('Places Autocomplete error', res.status);
    return [];
  }

  const json = await res.json();
  const suggestions = json.suggestions ?? [];

  return suggestions
    .filter((s) => s.placePrediction)
    .map((s) => {
      const p = s.placePrediction;
      const structuredFormat = p.structuredFormat ?? {};
      const mainText = structuredFormat.mainText?.text ?? p.text?.text ?? '';

      // Build group label: "Locality, Country" or just "Country"
      const parts = (structuredFormat.secondaryText?.text ?? '').split(', ');
      const groupLabel = parts.length >= 2
        ? `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`
        : parts[0] ?? '';

      return {
        placeId: p.placeId,
        description: p.text?.text ?? '',
        mainText,
        groupLabel,
      };
    });
}

const PLACE_DETAIL_URL = 'https://places.googleapis.com/v1/places';
const DETAIL_FIELDS = 'id,displayName,formattedAddress,location,googleMapsUri';

/**
 * Fetch full place details for a selected placeId.
 *
 * @param {string} placeId
 * @param {string} apiKey
 * @returns {Promise<{name, fullAddress, lat, lng, googlePlaceId, googleMapsUri}>}
 */
export async function fetchPlaceDetails(placeId, apiKey) {
  const res = await fetch(`${PLACE_DETAIL_URL}/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAIL_FIELDS,
    },
  });

  if (!res.ok) {
    console.error('Places Details error', res.status);
    return null;
  }

  const place = await res.json();
  return {
    name: place.displayName?.text ?? '',
    fullAddress: place.formattedAddress ?? '',
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    googlePlaceId: place.id ?? '',
    googleMapsUri: place.googleMapsUri ?? '',
  };
}
