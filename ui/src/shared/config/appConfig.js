// Reads runtime config injected via public/runtime-config.js, falling back
// to Vite env vars for local dev.
const runtime = typeof window !== "undefined" ? window.__APP_CONFIG__ : undefined;

// In dev, ui/.env wins. public/runtime-config.js is a build-time placeholder
// that is also served by the dev server, so without this a worktree pointing at
// its own API port (see scripts/new-worktree.sh) would be silently overridden
// back to :8000. In a built bundle the runtime config still wins, so one image
// can be repointed at a different API without a rebuild.
const devApiBaseUrl = import.meta.env.DEV ? import.meta.env.VITE_API_BASE_URL : undefined;

// Falls back to the page's own hostname (not a hardcoded "localhost") so the
// dev server works the same whether it's opened as localhost or over the LAN.
const defaultApiBaseUrl =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://localhost:8000";

export const appConfig = {
  apiBaseUrl:
    devApiBaseUrl ||
    runtime?.apiBaseUrl ||
    import.meta.env.VITE_API_BASE_URL ||
    defaultApiBaseUrl,
};
