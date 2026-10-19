import {
  cachedBaselineCount,
  clearBaselineCountCache,
} from "../cache";
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
import {
  CONTENT_ESTIMATE_WRAPPERS,
  isUsableContentEstimate,
  summarizeContentEstimate,
} from "./content-estimate";

const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";

interface CountResult {
  count: number;
  requestId: string | null;
}

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
  const apiKey = env.ANTHROPIC_API_KEY;

  async function countMessage(content: string): Promise<CountResult> {
    const headers = new Headers({
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    });
    const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim();
    if (workspaceId) headers.set("anthropic-workspace-id", workspaceId);

    const response = await fetchProviderResponse(
      env,
      "anthropic",
      model.upstreamModel,
      ENDPOINT,
      content,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model.upstreamModel,
          messages: [{ role: "user", content }],
        }),
        signal: timeoutSignal(env),
      },
    );
    await requireAnthropicOk(response);
    const body = await parseJsonObject(response);
    return {
      count: requireTokenCount(body.input_tokens),
      requestId: providerRequestId(response),
    };
  }

  async function measureWrapper(index: number): Promise<number> {
    const wrapper = CONTENT_ESTIMATE_WRAPPERS[index]!;
    const [baselineCount, wrapped] = await Promise.all([
      cachedBaselineCount(
        env,
        "anthropic",
        model.upstreamModel,
        `content-estimate-v1:${index}`,
        () => countMessage(`${wrapper.prefix}${wrapper.suffix}`).then(
          (result) => result.count,
        ),
      ),
      countMessage(`${wrapper.prefix}${text}${wrapper.suffix}`),
    ]);
    return wrapped.count - baselineCount;
  }

  const [messageCount, primaryOutcome] = await Promise.all([
    countMessage(text),
    Promise.allSettled([measureWrapper(0)]).then(([outcome]) => outcome!),
  ]);
  const outcomes = [primaryOutcome];
  if (
    primaryOutcome.status === "rejected" ||
    !isUsableContentEstimate(primaryOutcome.value, messageCount.count)
  ) {
    outcomes.push(...await Promise.allSettled(
      CONTENT_ESTIMATE_WRAPPERS.slice(1).map((_, index) =>
        measureWrapper(index + 1)
      ),
    ));
  }
  const estimate = summarizeContentEstimate(outcomes, messageCount.count);
  if (
    outcomes.length > 1 &&
    env.LOG_PROVIDER_IO?.trim().toLowerCase() === "true"
  ) {
    console.warn(JSON.stringify({
      event: "anthropic_content_estimate_fallback",
      model: model.upstreamModel,
      successful_wrappers: estimate.successfulWrappers,
      attempted_wrappers: outcomes.length,
    }));
  }

  return {
    provider: "anthropic",
    requested_model: model.publicId,
    resolved_model: model.upstreamModel,
    status: "ok",
    count_source: "hosted_message_count",
    token_count: messageCount.count,
    content_token_count: estimate.value,
    content_count_kind: estimate.value === null ? null : "estimated",
    content_token_count_min: estimate.minimum,
    content_token_count_max: estimate.maximum,
    supports_boundaries: false,
    token_ids: null,
    tokens: null,
    cache: "disabled",
    provider_request_id: messageCount.requestId,
  };
}

export const anthropicInternals = {
  estimateWrappers: CONTENT_ESTIMATE_WRAPPERS,
  clearBaselineCache(): void {
    clearBaselineCountCache();
  },
};
