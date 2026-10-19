import { ProviderError, classifyUpstreamStatus } from "../errors";
import type { Env, ProviderName } from "../types";

const DEFAULT_TIMEOUT_MS = 2500;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();

function loggingEnabled(env: Env): boolean {
  return env.LOG_PROVIDER_IO?.trim().toLowerCase() === "true";
}

function safeEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.origin}${url.pathname}`;
}

export async function fetchProviderResponse(
  env: Env,
  provider: ProviderName,
  model: string,
  endpoint: string,
  text: string,
  init: RequestInit,
): Promise<Response> {
  const shouldLog = loggingEnabled(env);
  const startedAt = Date.now();

  if (shouldLog) {
    console.info(JSON.stringify({
      event: "provider_request",
      provider,
      model,
      method: init.method ?? "GET",
      endpoint: safeEndpoint(endpoint),
      input_bytes: encoder.encode(text).byteLength,
    }));
  }

  try {
    const response = await fetch(endpoint, init);
    if (shouldLog) {
      console.info(JSON.stringify({
        event: "provider_response",
        provider,
        model,
        status: response.status,
        ok: response.ok,
        provider_request_id: providerRequestId(response),
        duration_ms: Date.now() - startedAt,
      }));
    }
    return response;
  } catch (error) {
    if (shouldLog) {
      console.error(JSON.stringify({
        event: "provider_response",
        provider,
        model,
        status: "transport_error",
        error: error instanceof Error ? error.name : "UnknownError",
        duration_ms: Date.now() - startedAt,
      }));
    }
    throw error;
  }
}

export function timeoutSignal(env: Env): AbortSignal {
  const configured = Number(env.UPSTREAM_TIMEOUT_MS);
  const milliseconds = Number.isFinite(configured)
    ? Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(configured)))
    : DEFAULT_TIMEOUT_MS;
  return AbortSignal.timeout(milliseconds);
}

export async function requireOk(response: Response): Promise<void> {
  if (!response.ok) throw classifyUpstreamStatus(response.status);
}

export async function parseJsonObject(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ProviderError("UPSTREAM_INVALID_RESPONSE", false);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderError("UPSTREAM_INVALID_RESPONSE", false);
  }
  return value as Record<string, unknown>;
}

export function providerRequestId(response: Response): string | null {
  return response.headers.get("request-id") ?? response.headers.get("x-request-id");
}

export function requireTokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError("UPSTREAM_INVALID_RESPONSE", false);
  }
  return value;
}
