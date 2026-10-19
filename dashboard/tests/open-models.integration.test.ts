import { describe, expect, it } from "vitest";
import {
  INITIAL_RESULTS,
  INITIAL_TEXT,
} from "../src/lib/initial-tokenization";
import { tokenizeOpenModels } from "../src/lib/open-model-tokenizers";
import { ENCODING_NAMES } from "../src/lib/tokenizer";

const runRemoteTests = process.env.TOKEVAL_REMOTE_TOKENIZER_TESTS === "1";

describe.runIf(runRemoteTests)("pinned open-model tokenizers", () => {
  it(
    "loads every artifact and preserves input bytes",
    async () => {
      const inputs = [
        INITIAL_TEXT,
        " 한글과 emoji 👋🏽, café\nmixed!",
        "e\u0301",
        "",
      ];

      for (const input of inputs) {
        const expectedBytes = Array.from(new TextEncoder().encode(input));
        const results = await tokenizeOpenModels(input);

        expect(results).toHaveLength(6);
        if (input === INITIAL_TEXT) {
          const comparableResult = (result: (typeof results)[number]) => ({
            profileId: result.profile.id,
            tokenizerRevision: result.tokenizerRevision,
            inputBytes: result.inputBytes,
            tokens: result.tokens,
          });

          const seededResults = new Map(
            INITIAL_RESULTS.slice(ENCODING_NAMES.length).map((result) => [
              result.profile.id,
              comparableResult(result),
            ]),
          );
          for (const result of results) {
            const seeded = seededResults.get(result.profile.id);
            if (seeded) expect(comparableResult(result)).toEqual(seeded);
          }
        }
        for (const result of results) {
          expect(result.tokens.flatMap((token) => token.bytes)).toEqual(
            expectedBytes,
          );
        }
      }

      const googleOnly = await tokenizeOpenModels("Hello", [
        "google-gemini-3-pro-preview",
      ]);
      expect(googleOnly.map((result) => result.profile.id)).toEqual([
        "google-gemini-3-pro-preview",
      ]);
    },
    60_000,
  );
});

