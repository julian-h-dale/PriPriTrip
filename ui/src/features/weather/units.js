/**
 * The weather API is metric (°C, m/s, mm), as OpenWeatherMap sends it; the
 * page shows °F, mph and inches, with °C alongside temperatures. Converting
 * here means a change of units never needs a refetch.
 */

export const toF = (c) => (c == null ? null : Math.round((c * 9) / 5 + 32));
export const toC = (c) => (c == null ? null : Math.round(c));
export const toMph = (ms) => (ms == null ? null : Math.round(ms * 2.23694));

/** "0.1 in", "<0.1 in" for a trace, or null for none/unknown. */
export function rainInches(mm) {
  if (mm == null || mm <= 0) return null;
  const inches = mm / 25.4;
  return inches < 0.05 ? "<0.1 in" : `${inches.toFixed(1)} in`;
}

/** "40%" from OpenWeatherMap’s 0 to 1 probability. */
export const percent = (p) => (p == null ? null : `${Math.round(p * 100)}%`);

/** "6:12 AM" at the place (its IANA zone), from an instant. */
export function placeTime(iso, zone) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone || "UTC" }).format(
      new Date(iso)
    );
  } catch {
    return null;
  }
}
