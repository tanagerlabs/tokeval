import type { TokenPiece, TokenizerProfile } from "./tokenizer";

export type HostedProvider = "anthropic" | "google" | "xai";
export type HostedStatus = "loading" | "ready" | "error";

export interface HostedModelProfile extends TokenizerProfile {
  id: "anthropic-default" | "gemini-default" | "grok-default";
  provider: HostedProvider;
  countSource: "hosted_message_count" | "hosted_input_count" | "hosted_token_breakdown";
  supportsBoundaries: boolean;
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

export const HOSTED_MODEL_PROFILES: HostedModelProfile[] = [
  {
    id: "anthropic-default",
    provider: "anthropic",
    encoding: "hosted message count",
    label: "Anthropic Claude",
    modelExamples: "Claude Opus 5.5",
    accent: "coral",
    countSource: "hosted_message_count",
    supportsBoundaries: false,
    sourceUrl: "https://platform.claude.com/docs/en/build-with-claude/token-counting",
  },
  {
    id: "gemini-default",
    provider: "google",
    encoding: "hosted input count",
    label: "Google Gemini",
    modelExamples: "Gemini 4 Argon",
    accent: "blue",
    countSource: "hosted_input_count",
    supportsBoundaries: false,
    sourceUrl: "https://ai.google.dev/api/tokens",
  },
  {
    id: "grok-default",
    provider: "xai",
    encoding: "hosted tokenize-text",
    label: "xAI Grok",
    modelExamples: "Grok 4.7",
    accent: "coral",
    countSource: "hosted_token_breakdown",
    supportsBoundaries: true,
    sourceUrl: "https://docs.x.ai/developers/rest-api-reference/inference/other",
  },
];

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
  profiles: readonly HostedModelProfile[] = HOSTED_MODEL_PROFILES,
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

function parseResult(value: unknown): HostedResult {
  if (!isRecord(value) || typeof value.requested_model !== "string") {
    throw new HostedApiError("INVALID_RESPONSE");
  }
  const profile = HOSTED_MODEL_PROFILES.find(
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
  profiles: readonly HostedModelProfile[] = HOSTED_MODEL_PROFILES,
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

  const results = body.results.map(parseResult);
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
