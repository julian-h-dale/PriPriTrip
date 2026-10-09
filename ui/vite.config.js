import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig(({ mode }) => {
  // "" prefix: load every key from ui/.env, not just VITE_-prefixed ones.
  const env = loadEnv(mode, __dirname, "");

  return {
    // A new id per build: the journal's outbox gives refused writes one more
    // try after an update (features/journal/journalSlice.js retryAfterUpdate).
    define: { __BUILD_ID__: JSON.stringify(new Date().toISOString()) },
    plugins: [
      react(),
      // Installable app + offline app shell. The service worker only ever
      // caches the app itself; trip data is cached by the app in IndexedDB
      // (shared/services/tripCache.js), per user. Off in `vite dev` — test it
      // with `npm run build && npm run preview` or `make image`.
      VitePWA({
        registerType: "prompt", // an "Update available · Reload" bar, never a surprise reload
        includeAssets: ["favicon.svg", "apple-touch-icon.png"],
        manifest: {
          name: "PriPriTrip",
          short_name: "PriPriTrip",
          description: "Everything for the trip in one place — works offline.",
          theme_color: "#12151c",
          background_color: "#12151c",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          // Injected when the container starts (deploy/runtime-config.js), so
          // it isn't part of the build's precache; network-first below.
          globIgnores: ["runtime-config.js"],
          navigateFallback: "/index.html",
          // Same-origin API in the container image lives under /api.
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname === "/runtime-config.js",
              handler: "NetworkFirst",
              options: { cacheName: "runtime-config", networkTimeoutSeconds: 3 },
            },
            // Journal photos: a photo's files never change under its id, so
            // cache-first is safe. Thumbnails are kept (a journal opened
            // once shows its photos offline); display copies are cached as
            // they're viewed, capped; originals are never cached (online only).
            // Status 0 = an opaque cross-origin <img> response (dev: the API
            // is another port; production is same-origin).
            {
              urlPattern: ({ url }) => /\/photos\/[0-9a-f-]{36}\/thumb$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "photo-thumbs",
                expiration: { maxEntries: 3000 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url }) => /\/photos\/[0-9a-f-]{36}\/display$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "photo-display",
                expiration: { maxEntries: 200, purgeOnQuotaError: true },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      // Per-worktree port (see scripts/new-worktree.sh). strictPort matters:
      // without it Vite silently falls forward to the next free port, which is
      // another worktree's port, while CORS_ORIGINS still names this one.
      port: Number(env.VITE_UI_PORT || 3000),
      strictPort: true,
      // Bind every interface, not just loopback, so the dev server is
      // reachable over the LAN (e.g. http://<host-ip>:3000).
      host: true,
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.js",
      css: false,
      // Playwright's specs live under e2e/ and run via `npm run test:e2e`, not vitest.
      exclude: ["**/node_modules/**", "e2e/**"],
    },
  };
});
