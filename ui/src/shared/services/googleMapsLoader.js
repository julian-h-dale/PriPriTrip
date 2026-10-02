import { getClientConfig } from "@/shared/services/clientConfig";

/**
 * The one place that injects the Google Maps JavaScript bootstrap script.
 * Everything that needs a library (places, maps, marker, ...) calls
 * `loadGoogleMapsLibrary("whatever")` — the script tag itself is only ever
 * added once, no matter how many libraries end up used across the app.
 */

export class GoogleMapsUnavailable extends Error {}

let loading = null;

function loadBootstrap(apiKey) {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const ready = () => resolve(window.google.maps);
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
        reject(new GoogleMapsUnavailable("Couldn’t load Google Maps"));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** Load one Maps JS library ("places", "maps", "marker", ...), by name. */
export async function loadGoogleMapsLibrary(name) {
  const { googleMapsApiKey } = await getClientConfig();
  if (!googleMapsApiKey) throw new GoogleMapsUnavailable("No Google Maps key is configured");
  const maps = await loadBootstrap(googleMapsApiKey);
  return maps.importLibrary(name);
}
