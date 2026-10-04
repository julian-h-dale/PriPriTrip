// Same-origin runtime config for the unified container image. The SPA and API
// are served from one origin, so the API base is a relative /api path that
// nginx rewrite-and-strips to the backend. This overwrites the dev default
// (public/runtime-config.js -> http://localhost:8000) at image build time.
window.__APP_CONFIG__ = { apiBaseUrl: "/api" };
