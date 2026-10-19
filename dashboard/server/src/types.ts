export type ProviderName = "anthropic" | "google" | "xai";

export type CountSource =
  | "hosted_message_count"
  | "hosted_input_count"
  | "hosted_token_breakdown";

export type CacheStatus = "hit" | "miss" | "coalesced" | "disabled";
export type ContentCountKind = "exact" | "estimated";

export type ProviderErrorCode =
  | "FEATURE_DISABLED"
  | "MISSING_PROVIDER_CREDENTIALS"
  | "ANTHROPIC_WORKSPACE_REQUIRED"
  | "UPSTREAM_AUTH_FAILED"
  | "UPSTREAM_INVALID_REQUEST"
  | "UPSTREAM_MODEL_UNAVAILABLE"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_INVALID_RESPONSE"
  | "UPSTREAM_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "UNKNOWN_UPSTREAM_ERROR";

export interface HostedToken {
  id: number;
  bytes: number[];
  text: string | null;
  byte_start: number;
  byte_end: number;
}

export interface ProviderSuccess {
  provider: ProviderName;
  requested_model: string;
  resolved_model: string;
  status: "ok";
  count_source: CountSource;
  token_count: number;
  content_token_count: number | null;
  content_count_kind: ContentCountKind | null;
  content_token_count_min: number | null;
  content_token_count_max: number | null;
  supports_boundaries: boolean;
  token_ids: number[] | null;
  tokens: HostedToken[] | null;
  cache: CacheStatus;
  provider_request_id: string | null;
}

export interface ProviderFailure {
  provider: ProviderName;
  requested_model: string;
  resolved_model: string | null;
  status: "unavailable";
  count_source: CountSource;
  token_count: null;
  content_token_count: null;
  content_count_kind: null;
  content_token_count_min: null;
  content_token_count_max: null;
  supports_boundaries: boolean;
  token_ids: null;
  tokens: null;
  cache: "disabled";
  provider_request_id: null;
  error: {
    code: ProviderErrorCode;
    retryable: boolean;
  };
}

export type ProviderResult = ProviderSuccess | ProviderFailure;

export interface ProviderSelection {
  provider: ProviderName;
  model: string;
}

export interface CompareRequest {
  text: string;
  providers: ProviderSelection[];
  request_id: string;
}

export interface ModelDefinition {
  publicId: string;
  provider: ProviderName;
  upstreamModel: string;
  capability: "count_only" | "token_breakdown";
  countSource: CountSource;
  enabled: boolean;
  cacheable: boolean;
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ALLOWED_ORIGINS?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  ANTHROPIC_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  XAI_API_KEY?: string;
  XAI_MODEL?: string;
  ENABLE_XAI?: string;
  ADDITIONAL_MODELS_JSON?: string;
  CACHE_HMAC_SECRET?: string;
  COUNT_CACHE_TTL_SECONDS?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  LOG_PROVIDER_IO?: string;
  REQUEST_RATE_LIMITER?: RateLimitBinding;
  XAI_RATE_LIMITER?: RateLimitBinding;
}

export interface RequestContext {
  waitUntil(promise: Promise<unknown>): void;
}
