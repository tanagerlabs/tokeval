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

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface CountResult {
  count: number;
  requestId: string | null;
}

const baselineCounts = new Map<string, Promise<number>>();

export async function countGemini(
  env: Env,
  model: ModelDefinition,
  text: string,
): Promise<ProviderSuccess> {
  if (!env.GEMINI_API_KEY) {
    throw new ProviderError("MISSING_PROVIDER_CREDENTIALS", false);
  }

  const endpoint = `${BASE_URL}/${encodeURIComponent(model.upstreamModel)}:countTokens`;
  const apiKey = env.GEMINI_API_KEY;

  async function countContent(content: string): Promise<CountResult> {
    const response = await fetchProviderResponse(
      env,
      "google",
      model.upstreamModel,
      endpoint,
      content,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: content }] }],
        }),
        signal: timeoutSignal(env),
      },
    );
    await requireOk(response);
    const body = await parseJsonObject(response);
    return {
      count: requireTokenCount(body.totalTokens),
      requestId: providerRequestId(response),
    };
  }

  const estimateOutcomes = Promise.allSettled(
    CONTENT_ESTIMATE_WRAPPERS.map(async ({ prefix, suffix }, index) => {
      const baselineKey = `${model.upstreamModel}\u0000${index}`;
      let baseline = baselineCounts.get(baselineKey);
      if (!baseline) {
        const pending = countContent(`${prefix}${suffix}`).then(
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
        countContent(`${prefix}${text}${suffix}`),
      ]);
      return Math.max(1, wrapped.count - baselineCount);
    }),
  );

  const [inputCount, outcomes] = await Promise.all([
    countContent(text),
    estimateOutcomes,
  ]);
  const estimate = summarizeContentEstimate(outcomes);
  if (
    estimate.successfulWrappers !== CONTENT_ESTIMATE_WRAPPERS.length &&
    env.LOG_PROVIDER_IO?.trim().toLowerCase() === "true"
  ) {
    console.warn(JSON.stringify({
      event: "gemini_content_estimate_partial",
      model: model.upstreamModel,
      successful_wrappers: estimate.successfulWrappers,
      total_wrappers: CONTENT_ESTIMATE_WRAPPERS.length,
    }));
  }

  return {
    provider: "google",
    requested_model: model.publicId,
    resolved_model: model.upstreamModel,
    status: "ok",
    count_source: "hosted_input_count",
    token_count: inputCount.count,
    content_token_count: estimate.value,
    content_count_kind: estimate.value === null ? null : "estimated",
    content_token_count_min: estimate.minimum,
    content_token_count_max: estimate.maximum,
    supports_boundaries: false,
    token_ids: null,
    tokens: null,
    cache: "disabled",
    provider_request_id: inputCount.requestId,
  };
}

export const geminiInternals = {
  estimateWrappers: CONTENT_ESTIMATE_WRAPPERS,
  clearBaselineCache(): void {
    baselineCounts.clear();
  },
};
