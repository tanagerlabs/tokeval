import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://tokeval.dev",
  integrations: [react()],
  output: "static",
  build: {
    inlineStylesheets: "auto",
  },
  vite: {
    server: {
      proxy: {
        // Keep browser requests on Astro's origin so a single forwarded port
        // works for remote development. Astro forwards these requests to the
        // local Wrangler process on the development host.
        "/api": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
        },
      },
    },
    build: {
      cssMinify: "lightningcss",
      // Vocabulary tables are intentionally isolated, lazy-loaded data chunks.
      chunkSizeWarningLimit: 2500,
    },
  },
});
