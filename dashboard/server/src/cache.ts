import type {
  CacheStatus,
  Env,
  ProviderName,
  ProviderSuccess,
  RequestContext,
} from "./types";

const inFlight = new Map<string, Promise<ProviderSuccess>>();
const CACHE_ORIGIN = "https://count-cache.internal";
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;

type CacheApi = Pick<Cache, "match" | "put">;

function cacheApi(): CacheApi | null {
  return typeof caches === "undefined" ? null : caches.default;
}

function ttlSeconds(env: Env): number {
  const configured = Number(env.COUNT_CACHE_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS;
  return Math.max(0, Math.min(MAX_TTL_SECONDS, Math.floor(configured)));
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function coalescingKey(
  provider: ProviderName,
  model: string,
  text: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await digestHex(
    encoder.encode(`${provider}\u0000${model}\u0000${text}`),
  );
  return `${provider}:${model}:${digest}`;
}

async function persistentCacheRequest(
  env: Env,
  provider: ProviderName,
  model: string,
  text: string,
): Promise<Request | null> {
  if (!env.CACHE_HMAC_SECRET || env.CACHE_HMAC_SECRET.length < 32 || ttlSeconds(env) === 0) {
    return null;
  }
  const digest = await hmacHex(
    env.CACHE_HMAC_SECRET,
    `v3\u0000${provider}\u0000${model}\u0000${text}`,
  );
  return new Request(`${CACHE_ORIGIN}/v3/${provider}/${encodeURIComponent(model)}/${digest}`);
}

function withCacheStatus(result: ProviderSuccess, cache: CacheStatus): ProviderSuccess {
  return {
    ...result,
    cache,
    provider_request_id:
      cache === "hit" || cache === "coalesced" ? null : result.provider_request_id,
  };
}

function safeCachedValue(result: ProviderSuccess): ProviderSuccess {
  return {
    ...result,
    cache: "miss",
    provider_request_id: null,
  };
}

function isCachedSuccess(value: unknown): value is ProviderSuccess {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProviderSuccess>;
  return (
    candidate.status === "ok" &&
    typeof candidate.token_count === "number" &&
    Number.isSafeInteger(candidate.token_count) &&
    candidate.token_count >= 0 &&
    candidate.tokens === null &&
    candidate.token_ids === null
  );
}

export async function cachedCountOnlyRequest(
  env: Env,
  context: RequestContext,
  provider: ProviderName,
  model: string,
  text: string,
  load: () => Promise<ProviderSuccess>,
): Promise<ProviderSuccess> {
  const sharedCache = cacheApi();
  const persistentRequest = sharedCache
    ? await persistentCacheRequest(env, provider, model, text)
    : null;

  if (sharedCache && persistentRequest) {
    const cached = await sharedCache.match(persistentRequest);
    if (cached) {
      const value: unknown = await cached.json();
      if (isCachedSuccess(value)) return withCacheStatus(value, "hit");
    }
  }

  const key = await coalescingKey(provider, model, text);
  const pending = inFlight.get(key);
  if (pending) return withCacheStatus(await pending, "coalesced");

  const promise = load();
  inFlight.set(key, promise);
  try {
    const result = await promise;
    const status: CacheStatus = persistentRequest ? "miss" : "disabled";

    if (sharedCache && persistentRequest) {
      const response = Response.json(safeCachedValue(result), {
        headers: {
          "Cache-Control": `public, max-age=${ttlSeconds(env)}`,
        },
      });
      context.waitUntil(sharedCache.put(persistentRequest, response));
    }

    return withCacheStatus(result, status);
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}

export async function coalesceUncachedRequest(
  provider: ProviderName,
  model: string,
  text: string,
  load: () => Promise<ProviderSuccess>,
): Promise<ProviderSuccess> {
  const key = await coalescingKey(provider, model, text);
  const pending = inFlight.get(key);
  if (pending) return withCacheStatus(await pending, "coalesced");

  const promise = load();
  inFlight.set(key, promise);
  try {
    return withCacheStatus(await promise, "disabled");
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}
