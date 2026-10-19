import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { readFileSync } from "node:fs";

const SENTENCEPIECE_PACKAGE_ID = "@sctg/sentencepiece-js";
const SLIM_SENTENCEPIECE_ID = "\0tokeval:slim-sentencepiece-runtime";
const UNUSED_SENTENCEPIECE_MODELS = [
  "llama_3_1_tokeniser_b64",
  "smart_b64",
  "clean_30k_b64",
];
const VITE_CACHE_DIR = process.env.NODE_ENV === "production"
  ? "node_modules/.vite-build"
  : "node_modules/.vite-dev";

function removeBase64Declaration(code, name) {
  const start = code.indexOf(`const ${name} = \"`);
  if (start < 0) throw new Error(`Could not find ${name} in pinned SentencePiece bundle.`);
  const end = code.indexOf('";', start);
  if (end < 0) throw new Error(`Could not trim ${name} from pinned SentencePiece bundle.`);
  return `${code.slice(0, start)}${code.slice(end + 2)}`;
}

/**
 * @sctg/sentencepiece-js@1.3.3 bundles three unrelated default models beside
 * its WASM runtime. Remove those exports before Rollup parses the module so
 * local Gemma/Grok rows ship only the processor that consumes their pinned
 * external model artifacts.
 */
function slimSentencePieceRuntime() {
  return {
    name: "tokeval-slim-sentencepiece-runtime",
    enforce: "pre",
    resolveId(id) {
      return id === SENTENCEPIECE_PACKAGE_ID ? SLIM_SENTENCEPIECE_ID : null;
    },
    load(id) {
      if (id !== SLIM_SENTENCEPIECE_ID) return null;
      let code = readFileSync(
        new URL(
          "./node_modules/@sctg/sentencepiece-js/dist/index.js",
          import.meta.url,
        ),
        "utf8",
      );
      for (const name of UNUSED_SENTENCEPIECE_MODELS) {
        code = removeBase64Declaration(code, name);
      }
      code = code
        .replace("import * as fs from 'fs';\n", "")
        .replace("import { Buffer as Buffer$1 } from 'buffer';\n", "")
        .replace(
          "const{createRequire}=await import('module');",
          "throw new Error('Node is unsupported by TokEval browser workers');",
        )
        .replace(
          /if \(typeof globalThis\.Buffer === 'undefined'\) \{\s*globalThis\.Buffer = Buffer\$1;\s*\}/,
          "",
        );
      code = code.replace(
        /export \{ SentencePieceProcessor, cleanText, clean_30k_b64, index as default, llama_3_1_tokeniser_b64, smart_b64 \};/,
        "export { SentencePieceProcessor, cleanText, index as default };",
      );
      return { code, map: null };
    },
  };
}

export default defineConfig({
  site: "https://tokeval.dev",
  integrations: [react()],
  output: "static",
  build: {
    inlineStylesheets: "auto",
  },
  vite: {
    // Astro check/build run with NODE_ENV=production. Keep their optimized
    // React runtime separate from the development server's JSX runtime so a
    // build cannot blank a concurrently running dashboard during hydration.
    cacheDir: VITE_CACHE_DIR,
    plugins: [slimSentencePieceRuntime()],
    worker: {
      plugins: () => [slimSentencePieceRuntime()],
    },
    optimizeDeps: {
      // These large rank tables are loaded only after an OpenAI row needs to
      // update. Prebundling them gives the dev server a versioned optimize-dep
      // URL that can go stale before the first edit and return HTTP 504.
      exclude: [
        "@sctg/sentencepiece-js",
        "js-tiktoken/ranks/o200k_base",
        "js-tiktoken/ranks/cl100k_base",
      ],
    },
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
