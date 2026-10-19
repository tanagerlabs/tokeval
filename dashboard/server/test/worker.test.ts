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
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

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
    expect(JSON.stringify(warning.mock.calls)).toContain("worker_request_rejected");
    expect(JSON.stringify(warning.mock.calls)).toContain("https://evil.example");
  });

  test("allows each configured local dashboard origin", async () => {
    const env: Env = {
      ALLOWED_ORIGINS:
        "http://localhost:4321,http://127.0.0.1:4321,http://[::1]:4321",
    };

    for (const origin of [
      "http://localhost:4321",
      "http://127.0.0.1:4321",
      "http://[::1]:4321",
    ]) {
      const response = await workerInternals.handleRequest(
        new Request("https://api.tokeval.test/api/v1/models", {
          headers: { origin },
        }),
        env,
        context,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  test("returns count-only results and an independently disabled xAI row", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as {
          messages?: Array<{ content: string }>;
          contents?: Array<{ parts: Array<{ text: string }> }>;
        };
        if (url.includes("anthropic")) {
          const content = body.messages?.[0]?.content ?? "";
          return Response.json({
            input_tokens: content === "secret phrase" ? 8 : 10 + Number(content.includes("secret phrase")),
          });
        }
        if (url.includes("googleapis")) {
          const content = body.contents?.[0]?.parts[0]?.text ?? "";
          return Response.json({
            totalTokens: content === "secret phrase" ? 6 : 10 + Number(content.includes("secret phrase")),
          });
        }
        throw new Error(`Unexpected upstream ${url}`);
      });
    vi.stubGlobal("fetch", upstream);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const env: Env = {
      ALLOWED_ORIGINS: "https://tokeval.test",
      ANTHROPIC_API_KEY: "anthropic-private-key",
      GEMINI_API_KEY: "gemini-private-key",
      ENABLE_XAI: "false",
      LOG_PROVIDER_IO: "true",
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
      {
        provider: "anthropic",
        status: "ok",
        token_count: 8,
        content_token_count: 1,
        content_count_kind: "estimated",
        tokens: null,
      },
      {
        provider: "google",
        status: "ok",
        token_count: 6,
        content_token_count: 1,
        content_count_kind: "estimated",
        tokens: null,
      },
      {
        provider: "xai",
        status: "unavailable",
        error: { code: "FEATURE_DISABLED", retryable: false },
      },
    ]);
    expect(body.meta.retained_input).toBe(false);
    const serializedLogs = JSON.stringify(log.mock.calls);
    expect(serializedLogs).toContain("hosted_tokenize_request");
    expect(serializedLogs).toContain("hosted_tokenize_response");
    expect(serializedLogs).toContain("provider_response");
    expect(serializedLogs).not.toContain("secret phrase");
    expect(serializedLogs).not.toContain("anthropic-private-key");
    expect(serializedLogs).not.toContain("gemini-private-key");
    expect(upstream).toHaveBeenCalledTimes(6);
  });

  test("logs xAI request metadata without logging reconstructable token data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          token_ids: [
            {
              token_id: 987654,
              string_token: "private input",
              token_bytes: Array.from(new TextEncoder().encode("private input")),
            },
          ],
        }),
      ),
    );
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await workerInternals.handleRequest(
      compareRequest({
        text: "private input",
        providers: [{ provider: "xai", model: "grok-default" }],
        request_id: "request-xai",
      }),
      {
        ALLOWED_ORIGINS: "https://tokeval.test",
        XAI_API_KEY: "xai-private-key",
        ENABLE_XAI: "true",
        LOG_PROVIDER_IO: "true",
      },
      context,
    );

    expect(response.status).toBe(200);
    const serializedLogs = JSON.stringify(log.mock.calls);
    expect(serializedLogs).toContain("provider_request");
    expect(serializedLogs).toContain("hosted_tokenize_response");
    expect(serializedLogs).not.toContain("private input");
    expect(serializedLogs).not.toContain("987654");
    expect(serializedLogs).not.toContain("xai-private-key");
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
