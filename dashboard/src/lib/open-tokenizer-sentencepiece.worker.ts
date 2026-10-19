/// <reference lib="webworker" />

import {
  SENTENCEPIECE_MODEL_PROFILES,
  tokenizeSentencePieceModel,
} from "./open-tokenizer-sentencepiece";

interface TokenizeRequest {
  id: number;
  text: string;
  profileIds: string[];
}

self.onmessage = async (event: MessageEvent<TokenizeRequest>) => {
  const { id, text, profileIds } = event.data;
  const selected = new Set(profileIds);
  try {
    const results = await Promise.all(
      SENTENCEPIECE_MODEL_PROFILES
        .filter((profile) => selected.has(profile.id))
        .map((profile) => tokenizeSentencePieceModel(text, profile)),
    );
    self.postMessage({ id, results });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Could not tokenize text.",
    });
  }
};
