import { ProviderError } from "../errors";
import type { Env, HostedToken, ModelDefinition, ProviderSuccess } from "../types";
import {
  parseJsonObject,
  providerRequestId,
  requireOk,
  timeoutSignal,
} from "./shared";

const ENDPOINT = "https://api.x.ai/v1/tokenize-text";
const encoder = new TextEncoder();

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

function tokenText(stringToken: unknown, bytes: Uint8Array): string | null {
  if (typeof stringToken !== "string") return null;
  try {
    const decoded = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
    return decoded === stringToken ? stringToken : null;
  } catch {
    return null;
  }
}

function normalizeTokens(value: unknown, inputText: string): HostedToken[] {
  if (!Array.isArray(value)) {
    throw new ProviderError("UPSTREAM_INVALID_RESPONSE", false);
  }

  let byteOffset = 0;
  const tokens = value.map((item): HostedToken => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ProviderError("UPSTREAM_INVALID_RESPONSE", false);
    }
    const raw = item as Record<string, unknown>;
    if (!Number.isSafeInteger(raw.token_id)) {
      throw new ProviderError("UPSTREAM_INVALID_RESPONSE", false);
    }
    if (
      !Array.isArray(raw.token_bytes) ||
      !raw.token_bytes.every(
        (byte) => Number.isInteger(byte) && (byte as number) >= 0 && (byte as number) <= 255,
      )
    ) {
      throw new ProviderError("UPSTREAM_INVALID_RESPONSE", false);
    }

    const bytes = Uint8Array.from(raw.token_bytes as number[]);
    const byteStart = byteOffset;
    byteOffset += bytes.length;
    return {
      id: raw.token_id as number,
      bytes: Array.from(bytes),
      text: tokenText(raw.string_token, bytes),
      byte_start: byteStart,
      byte_end: byteOffset,
    };
  });

  const reconstructed = Uint8Array.from(tokens.flatMap((token) => token.bytes));
  if (!equalBytes(reconstructed, encoder.encode(inputText))) {
    throw new ProviderError("UPSTREAM_INVALID_RESPONSE", false);
  }
  return tokens;
}

export async function tokenizeXai(
  env: Env,
  model: ModelDefinition,
  text: string,
): Promise<ProviderSuccess> {
  if (!env.XAI_API_KEY) {
    throw new ProviderError("MISSING_PROVIDER_CREDENTIALS", false);
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.XAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text, model: model.upstreamModel }),
    signal: timeoutSignal(env),
  });
  await requireOk(response);
  const body = await parseJsonObject(response);
  const tokens = normalizeTokens(body.token_ids, text);

  return {
    provider: "xai",
    requested_model: model.publicId,
    resolved_model: model.upstreamModel,
    status: "ok",
    count_source: "hosted_token_breakdown",
    token_count: tokens.length,
    supports_boundaries: true,
    token_ids: tokens.map((token) => token.id),
    tokens,
    cache: "disabled",
    provider_request_id: providerRequestId(response),
  };
}

export const xaiInternals = { normalizeTokens };
