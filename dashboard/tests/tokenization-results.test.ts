import { describe, expect, test } from "vitest";
import {
  removeTokenizationResults,
  replaceTokenizationResults,
} from "../src/lib/tokenization-results";
import type { TokenizationResult } from "../src/lib/tokenizer";

function result(id: string, tokenId: number): TokenizationResult {
  return {
    profile: {
      id,
      provider: "openai",
      encoding: id,
      label: id,
      modelExamples: id,
      accent: "blue",
    },
    tokenizerRevision: "test",
    countSource: "local_tokenizer",
    inputBytes: 1,
    tokens: [
      {
        index: 0,
        id: tokenId,
        bytes: [97],
        byteStart: 0,
        byteEnd: 1,
        text: "a",
      },
    ],
  };
}

describe("tokenization result groups", () => {
  test("updates one tokenizer group without disturbing another", () => {
    const current = [result("core", 1), result("open", 2)];
    const next = [result("core", 3)];

    expect(replaceTokenizationResults(current, next, new Set(["core"]))).toEqual([
      current[1],
      next[0],
    ]);
  });

  test("removes failed group results instead of leaving stale output", () => {
    const current = [result("core", 1), result("open", 2)];

    expect(removeTokenizationResults(current, new Set(["open"]))).toEqual([
      current[0],
    ]);
  });
});
