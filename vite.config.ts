import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One Worker serves the SPA (web/) and the API (src/). `npm run dev` runs both locally.
// FF_WRANGLER_CONFIG / FF_PERSIST point a local preview at a throwaway config and database
// (used for screenshots on synthetic data), never at a real installation.
export default defineConfig({
  root: "web",
  plugins: [
    react(),
    cloudflare({
      configPath: process.env.FF_WRANGLER_CONFIG ?? "../wrangler.jsonc",
      persistState: process.env.FF_PERSIST ? { path: process.env.FF_PERSIST } : true,
    }),
  ],
  build: { outDir: "../dist", emptyOutDir: true },
});
