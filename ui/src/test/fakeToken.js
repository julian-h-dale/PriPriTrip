/**
 * A JWT-shaped token whose `sub` is `userId` (unsigned — the client never
 * verifies). `exp` (ms since the epoch) is optional.
 */
export function fakeToken(userId, { exp } = {}) {
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const body = { sub: userId, aud: ["fastapi-users:auth"], ...(exp ? { exp: Math.floor(exp / 1000) } : {}) };
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(body)}.sig`;
}
