import { ProviderError } from "../errors";
import type { Env, ModelDefinition, ProviderSuccess } from "../types";
import {
  parseJsonObject,
  providerRequestId,
  requireOk,
  requireTokenCount,
  timeoutSignal,
} from "./shared";

const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";

export async function countAnthropic(
  env: Env,
  model: ModelDefinition,
  text: string,
): Promise<ProviderSuccess> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ProviderError("MISSING_PROVIDER_CREDENTIALS", false);
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model.upstreamModel,
      messages: [{ role: "user", content: text }],
    }),
    signal: timeoutSignal(env),
  });
  await requireOk(response);
  const body = await parseJsonObject(response);

  return {
    provider: "anthropic",
    requested_model: model.publicId,
    resolved_model: model.upstreamModel,
    status: "ok",
    count_source: "hosted_message_count",
    token_count: requireTokenCount(body.input_tokens),
    supports_boundaries: false,
    token_ids: null,
    tokens: null,
    cache: "disabled",
    provider_request_id: providerRequestId(response),
  };
}
