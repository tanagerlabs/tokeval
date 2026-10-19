import { afterEach, describe, expect, test, vi } from "vitest";
import { workerInternals } from "../src/index";
import type { Env, RequestContext } from "../src/types";

const context: RequestContext = { waitUntil: vi.fn() };

function compareRequest(
  body: unknown,
  origin = "https://tokeval.test",
): Request {
  return new Request("https://api.tokeval.test/api/v1/tokenize/compare", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "cf-connecting-ip": "192.0.2.1",
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Worker request handling", () => {
  test("rejects an unapproved browser origin before provider calls", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await workerInternals.handleRequest(
      compareRequest(
        {
          text: "hello",
          providers: [{ provider: "anthropic", model: "anthropic-default" }],
        },
        "https://evil.example",
      ),
      { ALLOWED_ORIGINS: "https://tokeval.test" },
      context,
    );

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  test("returns count-only results and an independently disabled xAI row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("anthropic")) return Response.json({ input_tokens: 8 });
        if (url.includes("googleapis")) return Response.json({ totalTokens: 6 });
        throw new Error(`Unexpected upstream ${url}`);
      }),
    );
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const env: Env = {
      ALLOWED_ORIGINS: "https://tokeval.test",
      ANTHROPIC_API_KEY: "a",
      GEMINI_API_KEY: "g",
      ENABLE_XAI: "false",
    };

    const response = await workerInternals.handleRequest(
      compareRequest({
        text: "secret phrase",
        providers: [
          { provider: "anthropic", model: "anthropic-default" },
          { provider: "google", model: "gemini-default" },
          { provider: "xai", model: "grok-default" },
        ],
        request_id: "request-1",
      }),
      env,
      context,
    );
    const body = (await response.json()) as {
      results: Array<Record<string, unknown>>;
      meta: { retained_input: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.results).toMatchObject([
      { provider: "anthropic", status: "ok", token_count: 8, tokens: null },
      { provider: "google", status: "ok", token_count: 6, tokens: null },
      {
        provider: "xai",
        status: "unavailable",
        error: { code: "FEATURE_DISABLED", retryable: false },
      },
    ]);
    expect(body.meta.retained_input).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret phrase");
  });

  test("enforces the anonymous request rate binding", async () => {
    const env: Env = {
      ALLOWED_ORIGINS: "https://tokeval.test",
      REQUEST_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
    };

    const response = await workerInternals.handleRequest(
      compareRequest({
        text: "hello",
        providers: [{ provider: "anthropic", model: "anthropic-default" }],
      }),
      env,
      context,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  test("rejects a provider/model mismatch", async () => {
    await expect(
      workerInternals.handleRequest(
        compareRequest({
          text: "hello",
          providers: [{ provider: "anthropic", model: "gemini-default" }],
        }),
        { ALLOWED_ORIGINS: "https://tokeval.test" },
        context,
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MODEL", status: 400 });
  });

  test("lists the configured registry without credentials", async () => {
    const response = await workerInternals.handleRequest(
      new Request("https://api.tokeval.test/api/v1/models", {
        headers: { origin: "https://tokeval.test" },
      }),
      {
        ALLOWED_ORIGINS: "https://tokeval.test",
        ANTHROPIC_MODEL: "claude-configured",
        GEMINI_MODEL: "gemini-configured",
        XAI_MODEL: "grok-configured",
      },
      context,
    );
    const body = (await response.json()) as { models: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.models).toMatchObject([
      { id: "anthropic-default", upstream_model: "claude-configured", enabled: true },
      { id: "gemini-default", upstream_model: "gemini-configured", enabled: true },
      { id: "grok-default", upstream_model: "grok-configured", enabled: false },
    ]);
  });

  test("loads additional models from configuration without adapter code changes", async () => {
    const response = await workerInternals.handleRequest(
      new Request("https://api.tokeval.test/api/v1/models", {
        headers: { origin: "https://tokeval.test" },
      }),
      {
        ALLOWED_ORIGINS: "https://tokeval.test",
        ADDITIONAL_MODELS_JSON: JSON.stringify([
          {
            id: "anthropic-next",
            provider: "anthropic",
            upstream_model: "claude-next-version",
          },
        ]),
      },
      context,
    );
    const body = (await response.json()) as { models: Array<Record<string, unknown>> };

    expect(body.models).toContainEqual(
      expect.objectContaining({
        id: "anthropic-next",
        upstream_model: "claude-next-version",
        capability: "count_only",
      }),
    );
  });
});
