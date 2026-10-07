/**
 * Whether a page is the first one opened in the app (a reload, a shared
 * link), so ← has nothing to go back to and goes up to a fixed page instead.
 * React Router keys that first entry "default", but replacing the address
 * (swiping between days or entries) gives it a new key, so a replace carries
 * the fact along in its state: navigate(to, { replace: true, state:
 * keepFirstEntry(location, state) }).
 */
export function isFirstEntry(location) {
  return location.key === "default" || Boolean(location.state?.firstEntry);
}

export function keepFirstEntry(location, state = {}) {
  return isFirstEntry(location) ? { ...state, firstEntry: true } : state;
}
