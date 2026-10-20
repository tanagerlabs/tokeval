import { describe, expect, test } from "vitest";
import { INITIAL_RESULTS } from "../src/lib/initial-tokenization";
import {
  buildModelCatalog,
  defaultModelOrder,
} from "../src/lib/model-catalog";
import { PROVIDER_CATALOG } from "../src/lib/catalog";

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
    expect(ids).toContain("google-gemini-3-pro-preview");
    expect(ids).toContain("cohere-command-a-plus");
    expect(ids).toContain("alibaba-qwen3-8b");
    expect(ids).toContain("microsoft-phi-4");
    expect(ids).toContain("moonshot-kimi-k2-instruct");
    expect(ids).toContain("zai-glm-4.5");
    expect(ids).toContain("ibm-granite-3.3-8b-instruct");
    expect(ids).toContain("nvidia-opencode-reasoning-nemotron-7b");
    expect(ids).toContain("anthropic-claude-sonnet-5-5");
    expect(ids).toContain("google-gemini-3.8-flash");
    expect(ids).toContain("openai-gpt-5-mini");
    expect(ids).toContain("meta-llama-4-scout");
    expect(ids).toContain("alibaba-qwen3-235b-a22b");
    expect(ids).toContain("google-gemini-2.5-flash");

    const qwenModels = catalog.filter((profile) =>
      profile.id.startsWith("alibaba-qwen3-"),
    );
    expect(qwenModels).toHaveLength(8);
    expect(new Set(qwenModels.map((profile) => profile.tokenizerId))).toEqual(
      new Set(["alibaba-qwen3-8b"]),
    );
  });

  test("has models for every configured provider", () => {
    const catalog = buildModelCatalog(INITIAL_RESULTS);
    for (const provider of PROVIDER_CATALOG) {
      expect(
        catalog.some((profile) => profile.provider === provider.id),
        `provider ${provider.id}`,
      ).toBe(true);
    }
  });
});
