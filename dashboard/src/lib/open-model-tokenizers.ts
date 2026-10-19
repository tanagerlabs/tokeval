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
  return Promise.all(
    OPEN_MODEL_PROFILES
      .filter((profile) => !selectedIds || selectedIds.has(profile.id))
      .map((profile) => {
        if (profile.decoder === "tiktoken") {
          return tokenizeLlamaModel(text, profile);
        }
        if (profile.decoder === "native_sentencepiece") {
          return tokenizeSentencePieceModel(text, profile);
        }
        return tokenizeHuggingFaceModel(text, profile);
      }),
  );
}
