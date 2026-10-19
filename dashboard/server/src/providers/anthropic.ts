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
  summarizeContentEstimate,
} from "./content-estimate";

const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";

interface CountResult {
  count: number;
  requestId: string | null;
}

const baselineCounts = new Map<string, Promise<number>>();

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

  const baselinePrefix = `${model.upstreamModel}\u0000${env.ANTHROPIC_WORKSPACE_ID?.trim() ?? ""}`;
  const estimateOutcomes = Promise.allSettled(
    CONTENT_ESTIMATE_WRAPPERS.map(async ({ prefix, suffix }, index) => {
      const baselineKey = `${baselinePrefix}\u0000${index}`;
      let baseline = baselineCounts.get(baselineKey);
      if (!baseline) {
        const pending = countMessage(`${prefix}${suffix}`).then(
          (result) => result.count,
        );
        baselineCounts.set(baselineKey, pending);
        void pending.catch(() => {
          if (baselineCounts.get(baselineKey) === pending) {
            baselineCounts.delete(baselineKey);
          }
        });
        baseline = pending;
      }

      const [baselineCount, wrapped] = await Promise.all([
        baseline,
        countMessage(`${prefix}${text}${suffix}`),
      ]);
      return Math.max(1, wrapped.count - baselineCount);
    }),
  );

  const [messageCount, outcomes] = await Promise.all([
    countMessage(text),
    estimateOutcomes,
  ]);
  const estimate = summarizeContentEstimate(outcomes);
  if (
    estimate.successfulWrappers !== CONTENT_ESTIMATE_WRAPPERS.length &&
    env.LOG_PROVIDER_IO?.trim().toLowerCase() === "true"
  ) {
    console.warn(JSON.stringify({
      event: "anthropic_content_estimate_partial",
      model: model.upstreamModel,
      successful_wrappers: estimate.successfulWrappers,
      total_wrappers: CONTENT_ESTIMATE_WRAPPERS.length,
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
    baselineCounts.clear();
  },
};
