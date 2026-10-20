import type { TokenPiece, TokenizerProfile } from "./tokenizer";
import {
  HOSTED_CATALOG_MODELS,
  providerCatalogEntry,
  type HostedCountSource,
} from "./catalog";

export type HostedProvider = "anthropic" | "google" | "xai";
export type HostedStatus = "loading" | "ready" | "error";

export interface HostedModelProfile extends TokenizerProfile {
  id: string;
  kind: "hosted";
  provider: HostedProvider;
  countSource: HostedCountSource;
  supportsBoundaries: boolean;
  enabled: boolean;
}

export interface HostedProviderError {
  code: string;
  retryable: boolean;
}

export interface HostedResult {
  profile: HostedModelProfile;
  resolvedModel: string | null;
  status: "ok" | "unavailable";
  /** Provider-reported count for the complete request shape. */
  tokenCount: number | null;
  /** Raw-content count when a provider exposes it, otherwise a labeled estimate. */
  contentTokenCount: number | null;
  contentCountKind: "exact" | "estimated" | null;
  contentTokenCountMin: number | null;
  contentTokenCountMax: number | null;
  tokens: TokenPiece[] | null;
  cache: "hit" | "miss" | "coalesced" | "disabled";
  error: HostedProviderError | null;
}

export const HOSTED_MODEL_PROFILES: HostedModelProfile[] =
  HOSTED_CATALOG_MODELS.map((model) => {
    if (!isHostedProvider(model.provider)) {
      throw new Error(`Unsupported hosted provider: ${model.provider}`);
    }
    return { ...model, provider: model.provider, enabled: true };
  });

const DEFAULT_HOSTED_MODEL_PROFILES = HOSTED_MODEL_PROFILES.filter((profile) =>
  profile.id === "anthropic-default" ||
  profile.id === "gemini-default" ||
  profile.id === "grok-default"
);

interface HostedModelListItem {
  id: string;
  provider: HostedProvider;
  upstream_model: string;
  capability: "count_only" | "token_breakdown";
  count_source: HostedCountSource;
  enabled: boolean;
}

function isHostedProvider(value: unknown): value is HostedProvider {
  return value === "anthropic" || value === "google" || value === "xai";
}

function humanizeModelId(value: string): string {
  return value
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => /^(ai|xai)$/i.test(part)
      ? part.toUpperCase()
      : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function profileFromModelListItem(item: HostedModelListItem): HostedModelProfile {
  const known = HOSTED_MODEL_PROFILES.find((profile) => profile.id === item.id);
  if (known) {
    const catalogModel = HOSTED_CATALOG_MODELS.find((model) => model.id === item.id);
    return {
      ...known,
      encoding: item.upstream_model,
      modelExamples: catalogModel?.upstreamModel === item.upstream_model
        ? known.modelExamples
        : humanizeModelId(item.upstream_model),
      countSource: item.count_source,
      supportsBoundaries: item.capability === "token_breakdown",
      enabled: item.enabled,
    };
  }

  const provider = providerCatalogEntry(item.provider);
  return {
    id: item.id,
    kind: "hosted",
    provider: item.provider,
    encoding: item.upstream_model,
    label: provider?.name ?? item.provider,
    modelExamples: humanizeModelId(item.upstream_model),
    accent: item.provider === "google" ? "blue" : "coral",
    countSource: item.count_source,
    supportsBoundaries: item.capability === "token_breakdown",
    enabled: item.enabled,
    sourceUrl: item.provider === "anthropic"
      ? "https://platform.claude.com/docs/en/build-with-claude/token-counting"
      : item.provider === "google"
        ? "https://ai.google.dev/api/tokens"
        : "https://docs.x.ai/developers/rest-api-reference/inference/other",
  };
}

export function hostedProfilesFromModelPayload(value: unknown): HostedModelProfile[] {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw new HostedApiError("INVALID_MODEL_CATALOG");
  }

  const ids = new Set<string>();
  return value.models.map((candidate): HostedModelProfile => {
    if (!isRecord(candidate)) throw new HostedApiError("INVALID_MODEL_CATALOG");
    const capability = candidate.capability;
    const countSource = candidate.count_source;
    if (
      typeof candidate.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(candidate.id) ||
      ids.has(candidate.id) ||
      !isHostedProvider(candidate.provider) ||
      typeof candidate.upstream_model !== "string" ||
      (capability !== "count_only" && capability !== "token_breakdown") ||
      (countSource !== "hosted_message_count" &&
        countSource !== "hosted_input_count" &&
        countSource !== "hosted_token_breakdown") ||
      typeof candidate.enabled !== "boolean"
    ) {
      throw new HostedApiError("INVALID_MODEL_CATALOG");
    }
    ids.add(candidate.id);
    return profileFromModelListItem(candidate as unknown as HostedModelListItem);
  });
}

export async function loadHostedModelProfiles(): Promise<HostedModelProfile[]> {
  const configured = import.meta.env.PUBLIC_HOSTED_TOKENIZER_API_URL?.trim();
  const endpoint = configured
    ? `${configured.replace(/\/$/, "")}/api/v1/models`
    : import.meta.env.DEV
      ? "http://127.0.0.1:8787/api/v1/models"
      : null;
  if (!endpoint) return HOSTED_MODEL_PROFILES;

  try {
    const response = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!response.ok) return HOSTED_MODEL_PROFILES;
    return hostedProfilesFromModelPayload(await response.json());
  } catch {
    return HOSTED_MODEL_PROFILES;
  }
}

export class HostedApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "HostedApiError";
    this.code = code;
  }
}

const SESSION_CACHE_ENTRY_LIMIT = 150;
const SESSION_CACHE_TOKEN_LIMIT = 20_000;
const sessionResults = new Map<string, HostedResult>();
let sessionTokenWeight = 0;

function resultTokenWeight(result: HostedResult): number {
  return Math.max(1, result.tokens?.length ?? 0);
}

function sessionCacheKey(
  text: string,
  profile: HostedModelProfile,
): string {
  return `${profile.id}\u0000${text}`;
}

function readSessionResult(
  text: string,
  profile: HostedModelProfile,
): HostedResult | null {
  const key = sessionCacheKey(text, profile);
  const cached = sessionResults.get(key);
  if (!cached) return null;
  sessionResults.delete(key);
  sessionResults.set(key, cached);
  return cached;
}

function writeSessionResult(text: string, result: HostedResult): void {
  const key = sessionCacheKey(text, result.profile);
  const existing = sessionResults.get(key);
  if (existing) sessionTokenWeight -= resultTokenWeight(existing);
  sessionResults.set(key, result);
  sessionTokenWeight += resultTokenWeight(result);
  while (
    sessionResults.size > SESSION_CACHE_ENTRY_LIMIT ||
    sessionTokenWeight > SESSION_CACHE_TOKEN_LIMIT
  ) {
    const oldest = sessionResults.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const removed = sessionResults.get(oldest);
    if (removed) sessionTokenWeight -= resultTokenWeight(removed);
    sessionResults.delete(oldest);
  }
}

export function readHostedSessionCache(
  text: string,
  profiles: readonly HostedModelProfile[] = DEFAULT_HOSTED_MODEL_PROFILES,
): HostedResult[] | null {
  const cached = profiles.map((profile) => readSessionResult(text, profile));
  return cached.every((result): result is HostedResult => result !== null)
    ? cached
    : null;
}

function compareEndpoint(): string | null {
  const configured = import.meta.env.PUBLIC_HOSTED_TOKENIZER_API_URL?.trim();
  if (configured) {
    return `${configured.replace(/\/$/, "")}/api/v1/tokenize/compare`;
  }
  return import.meta.env.DEV ? "/api/v1/tokenize/compare" : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptionalCount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new HostedApiError("INVALID_RESPONSE");
  }
  return value;
}

function parseTokens(value: unknown): TokenPiece[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new HostedApiError("INVALID_RESPONSE");

  return value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new HostedApiError("INVALID_RESPONSE");
    const { id, bytes, text, byte_start: byteStart, byte_end: byteEnd } = candidate;
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      !Array.isArray(bytes) ||
      !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ||
      (text !== null && typeof text !== "string") ||
      typeof byteStart !== "number" ||
      typeof byteEnd !== "number"
    ) {
      throw new HostedApiError("INVALID_RESPONSE");
    }
    return {
      index,
      id,
      bytes,
      text,
      byteStart,
      byteEnd,
    };
  });
}

function parseResult(
  value: unknown,
  profiles: readonly HostedModelProfile[],
): HostedResult {
  if (!isRecord(value) || typeof value.requested_model !== "string") {
    throw new HostedApiError("INVALID_RESPONSE");
  }
  const profile = profiles.find(
    (candidate) => candidate.id === value.requested_model,
  );
  if (!profile || (value.status !== "ok" && value.status !== "unavailable")) {
    throw new HostedApiError("INVALID_RESPONSE");
  }

  const error = isRecord(value.error) && typeof value.error.code === "string"
    ? {
        code: value.error.code,
        retryable: value.error.retryable === true,
      }
    : null;
  const tokenCount = value.token_count;
  if (
    tokenCount !== null &&
    (typeof tokenCount !== "number" || !Number.isSafeInteger(tokenCount) || tokenCount < 0)
  ) {
    throw new HostedApiError("INVALID_RESPONSE");
  }
  const contentTokenCount = parseOptionalCount(value.content_token_count);
  const contentTokenCountMin = parseOptionalCount(value.content_token_count_min);
  const contentTokenCountMax = parseOptionalCount(value.content_token_count_max);
  const contentCountKind = value.content_count_kind ?? null;
  if (
    contentCountKind !== null &&
    contentCountKind !== "exact" &&
    contentCountKind !== "estimated"
  ) {
    throw new HostedApiError("INVALID_RESPONSE");
  }

  return {
    profile,
    resolvedModel: typeof value.resolved_model === "string" ? value.resolved_model : null,
    status: value.status,
    tokenCount,
    contentTokenCount,
    contentCountKind,
    contentTokenCountMin,
    contentTokenCountMax,
    tokens: parseTokens(value.tokens),
    cache:
      value.cache === "hit" ||
      value.cache === "miss" ||
      value.cache === "coalesced" ||
      value.cache === "disabled"
        ? value.cache
        : "disabled",
    error,
  };
}

export async function compareHostedText(
  text: string,
  signal: AbortSignal,
  profiles: readonly HostedModelProfile[] = DEFAULT_HOSTED_MODEL_PROFILES,
): Promise<HostedResult[]> {
  const cachedByProfile = new Map<string, HostedResult>();
  const missingProfiles: HostedModelProfile[] = [];
  for (const profile of profiles) {
    const cached = readSessionResult(text, profile);
    if (cached) cachedByProfile.set(profile.id, cached);
    else missingProfiles.push(profile);
  }
  if (missingProfiles.length === 0) {
    return profiles.map((profile) => cachedByProfile.get(profile.id)!);
  }

  const endpoint = compareEndpoint();
  if (!endpoint) throw new HostedApiError("API_NOT_CONFIGURED");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        providers: missingProfiles.map((profile) => ({
          provider: profile.provider,
          model: profile.id,
        })),
        request_id: crypto.randomUUID(),
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new HostedApiError("NETWORK_OR_CORS");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HostedApiError("INVALID_RESPONSE");
  }
  if (!response.ok) {
    const code = isRecord(body) && isRecord(body.error) && typeof body.error.code === "string"
      ? body.error.code
      : `HTTP_${response.status}`;
    throw new HostedApiError(code);
  }
  if (!isRecord(body) || !Array.isArray(body.results)) {
    throw new HostedApiError("INVALID_RESPONSE");
  }

  const results = body.results.map((value) => parseResult(value, missingProfiles));
  const selectedResults = missingProfiles.map((profile) => {
    const result = results.find((candidate) => candidate.profile.id === profile.id);
    if (!result) throw new HostedApiError("INVALID_RESPONSE");
    return result;
  });
  for (const result of selectedResults) {
    if (result.status === "ok") writeSessionResult(text, result);
  }
  const fetchedByProfile = new Map(
    selectedResults.map((result) => [result.profile.id, result]),
  );
  return profiles.map((profile) =>
    cachedByProfile.get(profile.id) ?? fetchedByProfile.get(profile.id)!
  );
}

export const hostedTokenizerInternals = {
  clearSessionCache(): void {
    sessionResults.clear();
    sessionTokenWeight = 0;
  },
  get sessionCacheSize(): number {
    return sessionResults.size;
  },
};
