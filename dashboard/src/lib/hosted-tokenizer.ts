import type { TokenPiece, TokenizerProfile } from "./tokenizer";

export type HostedProvider = "anthropic" | "google" | "xai";
export type HostedStatus = "disabled" | "loading" | "ready" | "error";

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
  tokenCount: number | null;
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
    modelExamples: "Claude Sonnet 4.5",
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
    modelExamples: "Gemini 2.5 Flash",
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
    modelExamples: "Grok 4",
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

function apiBaseUrl(): string | null {
  const configured = import.meta.env.PUBLIC_HOSTED_TOKENIZER_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return import.meta.env.DEV ? "http://localhost:8787" : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  return {
    profile,
    resolvedModel: typeof value.resolved_model === "string" ? value.resolved_model : null,
    status: value.status,
    tokenCount,
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
): Promise<HostedResult[]> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new HostedApiError("API_NOT_CONFIGURED");

  const response = await fetch(`${baseUrl}/api/v1/tokenize/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      providers: HOSTED_MODEL_PROFILES.map((profile) => ({
        provider: profile.provider,
        model: profile.id,
      })),
      request_id: crypto.randomUUID(),
    }),
    signal,
  });

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
  return HOSTED_MODEL_PROFILES.map((profile) => {
    const result = results.find((candidate) => candidate.profile.id === profile.id);
    if (!result) throw new HostedApiError("INVALID_RESPONSE");
    return result;
  });
}
