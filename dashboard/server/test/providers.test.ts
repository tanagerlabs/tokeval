import { afterEach, describe, expect, test, vi } from "vitest";
import { ProviderError } from "../src/errors";
import { buildModelRegistry } from "../src/models";
import { countAnthropic } from "../src/providers/anthropic";
import { countGemini } from "../src/providers/gemini";
import { tokenizeXai, xaiInternals } from "../src/providers/xai";
import type { Env, ModelDefinition } from "../src/types";

function model(id: string, env: Env = {}): ModelDefinition {
  const value = buildModelRegistry(env).get(id);
  if (!value) throw new Error(`Missing model ${id}`);
  return value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Anthropic adapter", () => {
  test("wraps plain text in one user message and normalizes the count", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "claude-test",
        messages: [{ role: "user", content: "hello" }],
      });
      expect(new Headers(init?.headers).get("x-api-key")).toBe("anthropic-secret");
      return Response.json({ input_tokens: 7 }, { headers: { "request-id": "req-a" } });
    });
    vi.stubGlobal("fetch", upstream);

    const env: Env = {
      ANTHROPIC_API_KEY: "anthropic-secret",
      ANTHROPIC_MODEL: "claude-test",
    };
    const result = await countAnthropic(env, model("anthropic-default", env), "hello");

    expect(result).toMatchObject({
      token_count: 7,
      count_source: "hosted_message_count",
      supports_boundaries: false,
      provider_request_id: "req-a",
    });
  });
});

describe("Gemini adapter", () => {
  test("keeps the API key out of the URL", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:countTokens",
      );
      expect(String(input)).not.toContain("google-secret");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("google-secret");
      return Response.json({ totalTokens: 5 });
    });
    vi.stubGlobal("fetch", upstream);

    const env: Env = { GEMINI_API_KEY: "google-secret", GEMINI_MODEL: "gemini-test" };
    const result = await countGemini(env, model("gemini-default", env), "hello");

    expect(result.token_count).toBe(5);
    expect(result.count_source).toBe("hosted_input_count");
  });
});

describe("xAI adapter", () => {
  test("preserves exact byte spans and nulls split UTF-8 fragments", () => {
    const tokens = xaiInternals.normalizeTokens(
      [
        { token_id: 1, string_token: "�", token_bytes: [0xe3] },
        { token_id: 2, string_token: "�", token_bytes: [0x81, 0x82] },
      ],
      "あ",
    );

    expect(tokens).toEqual([
      { id: 1, bytes: [0xe3], text: null, byte_start: 0, byte_end: 1 },
      { id: 2, bytes: [0x81, 0x82], text: null, byte_start: 1, byte_end: 3 },
    ]);
  });

  test("rejects a response whose bytes do not reconstruct the input", () => {
    expect(() =>
      xaiInternals.normalizeTokens(
        [{ token_id: 1, string_token: "x", token_bytes: [120] }],
        "y",
      ),
    ).toThrowError(expect.objectContaining<Partial<ProviderError>>({
      code: "UPSTREAM_INVALID_RESPONSE",
    }));
  });

  test("normalizes a provider breakdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          token_ids: [
            { token_id: 11, string_token: "Hi", token_bytes: [72, 105] },
          ],
        }),
      ),
    );
    const env: Env = { XAI_API_KEY: "xai-secret", XAI_MODEL: "grok-test", ENABLE_XAI: "true" };
    const result = await tokenizeXai(env, model("grok-default", env), "Hi");

    expect(result).toMatchObject({
      token_count: 1,
      token_ids: [11],
      supports_boundaries: true,
      tokens: [{ id: 11, bytes: [72, 105], text: "Hi", byte_start: 0, byte_end: 2 }],
    });
  });
});
