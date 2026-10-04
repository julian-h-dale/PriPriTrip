/**
 * The signed-in user's id, read from the stored JWT's `sub` claim. Used to key
 * per-user offline data, so it has to work without a network round trip
 * (GET /users/me isn't reachable offline). The signature isn't checked here —
 * the server does that; this only picks which local cache to read.
 */
export function userIdFromToken(token) {
  const sub = claims(token)?.sub;
  return typeof sub === "string" && sub ? sub : null;
}

/** When the stored JWT expires (ms since the epoch), or null. Unverified, as above. */
export function tokenExpiry(token) {
  const exp = claims(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
}

function claims(token) {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}
