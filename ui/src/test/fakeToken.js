/** A JWT-shaped token whose `sub` is `userId` (unsigned — the client never verifies). */
export function fakeToken(userId) {
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: userId, aud: ["fastapi-users:auth"] })}.sig`;
}
