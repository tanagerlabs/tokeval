import { describe, expect, it } from "vitest";
import {
  INITIAL_RESULTS,
  INITIAL_TEXT,
} from "../src/lib/initial-tokenization";
import { tokenizeOpenModels } from "../src/lib/open-model-tokenizers";
import { OPEN_MODEL_PROFILES } from "../src/lib/open-model-profiles";
import { ENCODING_NAMES } from "../src/lib/tokenizer";

const runRemoteTests = process.env.TOKEVAL_REMOTE_TOKENIZER_TESTS === "1";
const INITIAL_EXPECTED_COUNTS: Record<string, number> = {
  "deepseek-v3.2": 11,
  "google-gemini-3-pro-preview": 7,
  "meta-llama-4": 7,
  "mistral-7b-v0.3": 18,
  "cohere-command-a-plus": 7,
  "xai-grok-1": 33,
  "alibaba-qwen3-8b": 9,
  "microsoft-phi-4": 14,
  "moonshot-kimi-k2-instruct": 16,
  "zai-glm-4.5": 12,
  "ibm-granite-3.3-8b-instruct": 14,
  "nvidia-opencode-reasoning-nemotron-7b": 9,
};

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
        const canonicalProfileIds = OPEN_MODEL_PROFILES
          .filter((profile) => profile.id === profile.tokenizerId)
          .map((profile) => profile.id);
        const results = await tokenizeOpenModels(input, canonicalProfileIds);
        expect(results).toHaveLength(canonicalProfileIds.length);
        if (input === INITIAL_TEXT) {
          expect(Object.fromEntries(results.map((result) => [
            result.profile.id,
            result.tokenCount ?? result.tokens.length,
          ]))).toEqual(INITIAL_EXPECTED_COUNTS);
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
          expect(result.tokenCount ?? result.tokens.length).toBeGreaterThanOrEqual(0);
          if (result.profile.supportsBoundaries === false) {
            expect(result.tokens).toEqual([]);
            expect(result.tokenCount).toBeTypeOf("number");
          } else {
            expect(result.tokens.flatMap((token) => token.bytes)).toEqual(
              expectedBytes,
            );
          }
        }
      }

      const googleOnly = await tokenizeOpenModels("Hello", [
        "google-gemini-3-pro-preview",
      ]);
      expect(googleOnly.map((result) => result.profile.id)).toEqual([
        "google-gemini-3-pro-preview",
      ]);

      const sharedQwen = await tokenizeOpenModels("Hello", [
        "alibaba-qwen3-8b",
        "alibaba-qwen3-235b-a22b",
      ]);
      expect(sharedQwen.map((result) => result.profile.id)).toEqual([
        "alibaba-qwen3-8b",
        "alibaba-qwen3-235b-a22b",
      ]);
      expect(sharedQwen[0]?.tokenCount).toBe(sharedQwen[1]?.tokenCount);
    },
    60_000,
  );
});

