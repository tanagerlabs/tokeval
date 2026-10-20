import { OPEN_MODEL_PROFILES } from "./open-model-profiles";
import { tokenizeHuggingFaceModel } from "./open-tokenizer-huggingface";
import { tokenizeLlamaModel } from "./open-tokenizer-llama";
import { tokenizeSentencePieceModel } from "./open-tokenizer-sentencepiece";
import type { TokenizationResult } from "./tokenizer";

export async function tokenizeOpenModels(
  text: string,
  profileIds?: readonly string[],
): Promise<TokenizationResult[]> {
  const selectedIds = profileIds ? new Set(profileIds) : null;
  const profiles = OPEN_MODEL_PROFILES.filter(
    (profile) => !selectedIds || selectedIds.has(profile.id),
  );
  const byTokenizer = new Map<string, Promise<TokenizationResult>>();
  return Promise.all(profiles.map(async (profile) => {
    let pending = byTokenizer.get(profile.tokenizerId);
    if (!pending) {
      pending = profile.decoder === "tiktoken"
        ? tokenizeLlamaModel(text, profile)
        : profile.decoder === "native_sentencepiece"
          ? tokenizeSentencePieceModel(text, profile)
          : tokenizeHuggingFaceModel(text, profile);
      byTokenizer.set(profile.tokenizerId, pending);
    }
    const result = await pending;
    return { ...result, profile };
  }));
}
