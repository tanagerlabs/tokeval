import { HOSTED_MODEL_PROFILES } from "./hosted-tokenizer";
import { OPEN_MODEL_PROFILES } from "./open-model-profiles";
import type { TokenizationResult, TokenizerProfile } from "./tokenizer";

export const DEFAULT_MODEL_IDS = [
  "openai-o200k",
  "anthropic-default",
  "gemini-default",
  "meta-llama-4",
  "grok-default",
] as const;

export function buildModelCatalog(
  initialResults: readonly TokenizationResult[],
): TokenizerProfile[] {
  const byId = new Map<string, TokenizerProfile>();

  for (const result of initialResults) byId.set(result.profile.id, result.profile);
  for (const profile of OPEN_MODEL_PROFILES) byId.set(profile.id, profile);
  for (const profile of HOSTED_MODEL_PROFILES) byId.set(profile.id, profile);

  return Array.from(byId.values());
}

export function defaultModelOrder(
  catalog: readonly TokenizerProfile[],
): string[] {
  const available = new Set(catalog.map((profile) => profile.id));
  return DEFAULT_MODEL_IDS.filter((id) => available.has(id));
}
