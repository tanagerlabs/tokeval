import { ProviderError, classifyUpstreamStatus } from "../errors";
import type { Env } from "../types";

const DEFAULT_TIMEOUT_MS = 2500;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 10_000;

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
