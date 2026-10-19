import { describe, expect, test } from "vitest";
import { INITIAL_RESULTS } from "../src/lib/initial-tokenization";
import {
  buildModelCatalog,
  defaultModelOrder,
} from "../src/lib/model-catalog";

describe("model catalog", () => {
  test("starts with one current model from each default provider", () => {
    const catalog = buildModelCatalog(INITIAL_RESULTS);

    expect(defaultModelOrder(catalog)).toEqual([
      "openai-o200k",
      "anthropic-default",
      "gemini-default",
      "meta-llama-4",
      "grok-default",
    ]);
  });

  test("keeps the remaining tokenizer integrations available to add", () => {
    const catalog = buildModelCatalog(INITIAL_RESULTS);
    const ids = catalog.map((profile) => profile.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("openai-cl100k");
    expect(ids).toContain("deepseek-v3.2");
    expect(ids).toContain("cohere-command-a-plus");
  });
});
