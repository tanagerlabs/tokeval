import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  integrations: [react()],
  output: "static",
  build: {
    inlineStylesheets: "auto",
  },
  vite: {
    build: {
      cssMinify: "lightningcss",
      // Vocabulary tables are intentionally isolated, lazy-loaded data chunks.
      chunkSizeWarningLimit: 2500,
    },
  },
});
