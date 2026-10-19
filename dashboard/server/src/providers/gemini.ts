import { ProviderError } from "../errors";
import type { Env, ModelDefinition, ProviderSuccess } from "../types";
import {
  parseJsonObject,
  providerRequestId,
  requireOk,
  requireTokenCount,
  timeoutSignal,
} from "./shared";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export async function countGemini(
  env: Env,
  model: ModelDefinition,
  text: string,
): Promise<ProviderSuccess> {
  if (!env.GEMINI_API_KEY) {
    throw new ProviderError("MISSING_PROVIDER_CREDENTIALS", false);
  }

  const response = await fetch(
    `${BASE_URL}/${encodeURIComponent(model.upstreamModel)}:countTokens`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
      }),
      signal: timeoutSignal(env),
    },
  );
  await requireOk(response);
  const body = await parseJsonObject(response);

  return {
    provider: "google",
    requested_model: model.publicId,
    resolved_model: model.upstreamModel,
    status: "ok",
    count_source: "hosted_input_count",
    token_count: requireTokenCount(body.totalTokens),
    supports_boundaries: false,
    token_ids: null,
    tokens: null,
    cache: "disabled",
    provider_request_id: providerRequestId(response),
  };
}
