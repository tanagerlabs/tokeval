import type { ProviderErrorCode } from "./types";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: ProviderErrorCode, retryable: boolean) {
    super(code);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function classifyUpstreamStatus(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("UPSTREAM_AUTH_FAILED", false);
  }
  if (status === 404) {
    return new ProviderError("UPSTREAM_MODEL_UNAVAILABLE", false);
  }
  if (status === 429) {
    return new ProviderError("UPSTREAM_RATE_LIMITED", true);
  }
  if (status >= 400 && status < 500) {
    return new ProviderError("UPSTREAM_INVALID_REQUEST", false);
  }
  if (status >= 500) {
    return new ProviderError("UPSTREAM_UNAVAILABLE", true);
  }
  return new ProviderError("UNKNOWN_UPSTREAM_ERROR", false);
}

export function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ProviderError("UPSTREAM_TIMEOUT", true);
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new ProviderError("UPSTREAM_TIMEOUT", true);
  }
  return new ProviderError("UNKNOWN_UPSTREAM_ERROR", false);
}
