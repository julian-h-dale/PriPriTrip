import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  // "" prefix: load every key from ui/.env, not just VITE_-prefixed ones.
  const env = loadEnv(mode, __dirname, "");

  return {
    plugins: [react()],
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
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.js",
      css: false,
    },
  };
});
