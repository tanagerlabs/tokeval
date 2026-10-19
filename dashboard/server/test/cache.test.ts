import { afterEach, describe, expect, test, vi } from "vitest";
import { cachedCountOnlyRequest } from "../src/cache";
import type { ProviderSuccess, RequestContext } from "../src/types";

class MemoryCache {
  readonly values = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.values.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.values.set(request.url, response.clone());
  }
}

function result(): ProviderSuccess {
  return {
    provider: "anthropic",
    requested_model: "anthropic-default",
    resolved_model: "claude-test",
    status: "ok",
    count_source: "hosted_message_count",
    token_count: 4,
    content_token_count: 2,
    content_count_kind: "estimated",
    content_token_count_min: 2,
    content_token_count_max: 3,
    supports_boundaries: false,
    token_ids: null,
    tokens: null,
    cache: "disabled",
    provider_request_id: "provider-request",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("count-only cache", () => {
  test("uses an opaque HMAC key and serves a repeated count", async () => {
    const memory = new MemoryCache();
    vi.stubGlobal("caches", { default: memory });
    const pending: Promise<unknown>[] = [];
    const context: RequestContext = {
      waitUntil(promise) {
        pending.push(promise);
      },
    };
    const load = vi.fn(async () => result());
    const env = {
      CACHE_HMAC_SECRET: "a sufficiently long cache test secret",
      COUNT_CACHE_TTL_SECONDS: "300",
    };

    const first = await cachedCountOnlyRequest(
      env,
      context,
      "anthropic",
      "claude-test",
      "private prompt",
      load,
    );
    await Promise.all(pending);
    const second = await cachedCountOnlyRequest(
      env,
      context,
      "anthropic",
      "claude-test",
      "private prompt",
      load,
    );

    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit");
    expect(load).toHaveBeenCalledTimes(1);
    const [key] = memory.values.keys();
    expect(key).not.toContain("private");
    expect(key).not.toContain("prompt");
  });

  test("disables persistent caching without an HMAC secret", async () => {
    vi.stubGlobal("caches", { default: new MemoryCache() });
    const load = vi.fn(async () => result());
    const value = await cachedCountOnlyRequest(
      {},
      { waitUntil: vi.fn() },
      "anthropic",
      "claude-test",
      "hello",
      load,
    );

    expect(value.cache).toBe("disabled");
    expect(load).toHaveBeenCalledOnce();
  });
});
