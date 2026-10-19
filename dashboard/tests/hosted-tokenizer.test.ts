import { afterEach, describe, expect, test, vi } from "vitest";
import { compareHostedText, HostedApiError } from "../src/lib/hosted-tokenizer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hosted tokenizer client", () => {
  test("requests all hosted providers and normalizes count and byte results", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe("/api/v1/tokenize/compare");
      const request = JSON.parse(String(init?.body)) as {
        providers: Array<{ provider: string; model: string }>;
      };
      expect(request.providers).toEqual([
        { provider: "anthropic", model: "anthropic-default" },
        { provider: "google", model: "gemini-default" },
        { provider: "xai", model: "grok-default" },
      ]);

      return Response.json({
        results: [
          {
            provider: "anthropic",
            requested_model: "anthropic-default",
            resolved_model: "claude-test",
            status: "ok",
            token_count: 3,
            tokens: null,
            cache: "miss",
          },
          {
            provider: "google",
            requested_model: "gemini-default",
            resolved_model: "gemini-test",
            status: "ok",
            token_count: 2,
            tokens: null,
            cache: "hit",
          },
          {
            provider: "xai",
            requested_model: "grok-default",
            resolved_model: "grok-test",
            status: "ok",
            token_count: 1,
            tokens: [
              {
                id: 9,
                bytes: [104, 105],
                text: "hi",
                byte_start: 0,
                byte_end: 2,
              },
            ],
            cache: "disabled",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", upstream);

    const results = await compareHostedText("hi", new AbortController().signal);

    expect(results).toMatchObject([
      { profile: { id: "anthropic-default" }, tokenCount: 3, tokens: null },
      { profile: { id: "gemini-default" }, tokenCount: 2, tokens: null },
      {
        profile: { id: "grok-default" },
        tokenCount: 1,
        tokens: [
          { id: 9, bytes: [104, 105], text: "hi", byteStart: 0, byteEnd: 2 },
        ],
      },
    ]);
  });

  test("preserves per-provider unavailable results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              requested_model: "anthropic-default",
              resolved_model: "claude-test",
              status: "unavailable",
              token_count: null,
              tokens: null,
              cache: "disabled",
              error: { code: "UPSTREAM_TIMEOUT", retryable: true },
            },
            {
              requested_model: "gemini-default",
              resolved_model: "gemini-test",
              status: "unavailable",
              token_count: null,
              tokens: null,
              cache: "disabled",
              error: { code: "UPSTREAM_TIMEOUT", retryable: true },
            },
            {
              requested_model: "grok-default",
              resolved_model: "grok-test",
              status: "unavailable",
              token_count: null,
              tokens: null,
              cache: "disabled",
              error: { code: "FEATURE_DISABLED", retryable: false },
            },
          ],
        }),
      ),
    );

    const results = await compareHostedText("hello", new AbortController().signal);

    expect(results[0]?.error).toEqual({ code: "UPSTREAM_TIMEOUT", retryable: true });
    expect(results[2]?.error).toEqual({ code: "FEATURE_DISABLED", retryable: false });
  });

  test("turns browser network and CORS failures into an actionable error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));

    await expect(
      compareHostedText("hello", new AbortController().signal),
    ).rejects.toEqual(expect.objectContaining<Partial<HostedApiError>>({
      code: "NETWORK_OR_CORS",
    }));
  });
});
