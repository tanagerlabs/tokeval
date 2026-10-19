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

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface CountResult {
  count: number;
  requestId: string | null;
}

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

  async function measureWrapper(index: number): Promise<number> {
    const wrapper = CONTENT_ESTIMATE_WRAPPERS[index]!;
    const [baselineCount, wrapped] = await Promise.all([
      cachedBaselineCount(
        env,
        "google",
        model.upstreamModel,
        `content-estimate-v1:${index}`,
        () => countContent(`${wrapper.prefix}${wrapper.suffix}`).then(
          (result) => result.count,
        ),
      ),
      countContent(`${wrapper.prefix}${text}${wrapper.suffix}`),
    ]);
    return wrapped.count - baselineCount;
  }

  const [inputCount, primaryOutcome] = await Promise.all([
    countContent(text),
    Promise.allSettled([measureWrapper(0)]).then(([outcome]) => outcome!),
  ]);
  const outcomes = [primaryOutcome];
  if (
    primaryOutcome.status === "rejected" ||
    !isUsableContentEstimate(primaryOutcome.value, inputCount.count)
  ) {
    outcomes.push(...await Promise.allSettled(
      CONTENT_ESTIMATE_WRAPPERS.slice(1).map((_, index) =>
        measureWrapper(index + 1)
      ),
    ));
  }
  const estimate = summarizeContentEstimate(outcomes, inputCount.count);
  if (
    outcomes.length > 1 &&
    env.LOG_PROVIDER_IO?.trim().toLowerCase() === "true"
  ) {
    console.warn(JSON.stringify({
      event: "gemini_content_estimate_fallback",
      model: model.upstreamModel,
      successful_wrappers: estimate.successfulWrappers,
      attempted_wrappers: outcomes.length,
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
    clearBaselineCountCache();
  },
};
