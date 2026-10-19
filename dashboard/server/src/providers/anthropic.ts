import { ProviderError } from "../errors";
import type { Env, ModelDefinition, ProviderSuccess } from "../types";
import {
  fetchProviderResponse,
  parseJsonObject,
  providerRequestId,
  requireOk,
  requireTokenCount,
  timeoutSignal,
} from "./shared";

const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";

async function requireAnthropicOk(response: Response): Promise<void> {
  if (response.ok) return;

  if (response.status === 400) {
    try {
      const body = await parseJsonObject(response.clone());
      const error = body.error;
      if (typeof error === "object" && error !== null && !Array.isArray(error)) {
        const message = (error as Record<string, unknown>).message;
        if (
          typeof message === "string" &&
          message.toLowerCase().includes("anthropic-workspace-id")
        ) {
          throw new ProviderError("ANTHROPIC_WORKSPACE_REQUIRED", false);
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
    }
  }

  await requireOk(response);
}

export async function countAnthropic(
  env: Env,
  model: ModelDefinition,
  text: string,
): Promise<ProviderSuccess> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ProviderError("MISSING_PROVIDER_CREDENTIALS", false);
  }

  const headers = new Headers({
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  });
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim();
  if (workspaceId) headers.set("anthropic-workspace-id", workspaceId);

  const response = await fetchProviderResponse(env, "anthropic", model.upstreamModel, ENDPOINT, text, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model.upstreamModel,
      messages: [{ role: "user", content: text }],
    }),
    signal: timeoutSignal(env),
  });
  await requireAnthropicOk(response);
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
