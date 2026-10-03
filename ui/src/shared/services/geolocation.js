/**
 * The phone's location, through the browser (navigator.geolocation). GPS
 * works with no signal, just slower to a first fix. Needs a secure context
 * (HTTPS, or localhost). The only file that touches the API — tests mock it.
 *
 *   position: { lat, lng, accuracy }   (accuracy: uncertainty radius, metres)
 */

export function geolocationAvailable() {
  return typeof navigator !== "undefined" && Boolean(navigator.geolocation);
}

/** "granted" | "denied" | "prompt" — without asking. */
export async function permissionState() {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    return status?.state ?? "prompt";
  } catch {
    return "prompt"; // Safari before 16 has no permissions API for this
  }
}

const toPosition = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });

/**
 * One reading, or null if it's unavailable, denied, or too slow. Never
 * throws and never waits longer than `timeout` — saving a memory must not
 * hang on a GPS fix. The first call is what shows the browser's prompt.
 */
export function currentPosition({ timeout = 8000, maximumAge = 60_000 } = {}) {
  if (!geolocationAvailable()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const guard = setTimeout(() => resolve(null), timeout + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(guard);
        resolve(toPosition(p));
      },
      () => {
        clearTimeout(guard);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout, maximumAge }
    );
  });
}

/** Follow the phone as it moves; returns a function that stops watching. */
export function watchPosition(onPosition, onError = () => {}) {
  if (!geolocationAvailable()) {
    onError();
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onPosition(toPosition(p)),
    () => onError(),
    { enableHighAccuracy: true, maximumAge: 10_000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}
