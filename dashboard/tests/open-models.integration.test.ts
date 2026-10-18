import { describe, expect, it } from "vitest";
import {
  INITIAL_RESULTS,
  INITIAL_TEXT,
} from "../src/lib/initial-tokenization";
import { tokenizeOpenModels } from "../src/lib/open-model-tokenizers";
import { ENCODING_NAMES } from "../src/lib/tokenizer";

const runRemoteTests = process.env.LLMTOKENLAB_REMOTE_TOKENIZER_TESTS === "1";

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

        expect(results).toHaveLength(5);
        if (input === INITIAL_TEXT) {
          const comparableResult = (result: (typeof results)[number]) => ({
            profileId: result.profile.id,
            tokenizerRevision: result.tokenizerRevision,
            inputBytes: result.inputBytes,
            tokens: result.tokens,
          });

          expect(
            INITIAL_RESULTS.slice(ENCODING_NAMES.length).map(comparableResult),
          ).toEqual(results.map(comparableResult));
        }
        for (const result of results) {
          expect(result.tokens.flatMap((token) => token.bytes)).toEqual(
            expectedBytes,
          );
        }
      }
    },
    60_000,
  );
});

