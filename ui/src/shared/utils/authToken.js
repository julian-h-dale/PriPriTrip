/**
 * The signed-in user's id, read from the stored JWT's `sub` claim. Used to key
 * per-user offline data, so it has to work without a network round trip
 * (GET /users/me isn't reachable offline). The signature isn't checked here —
 * the server does that; this only picks which local cache to read.
 */
export function userIdFromToken(token) {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}
