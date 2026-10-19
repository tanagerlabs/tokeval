import type { Env, ModelDefinition, ProviderSuccess } from "../types";
import { countAnthropic } from "./anthropic";
import { countGemini } from "./gemini";
import { tokenizeXai } from "./xai";

export function callProvider(
  env: Env,
  model: ModelDefinition,
  text: string,
): Promise<ProviderSuccess> {
  if (model.provider === "anthropic") return countAnthropic(env, model, text);
  if (model.provider === "google") return countGemini(env, model, text);
  return tokenizeXai(env, model, text);
}
