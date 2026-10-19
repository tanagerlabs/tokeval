/// <reference lib="webworker" />

import {
  HUGGINGFACE_MODEL_PROFILES,
  tokenizeHuggingFaceModel,
} from "./open-tokenizer-huggingface";

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
      HUGGINGFACE_MODEL_PROFILES
        .filter((profile) => selected.has(profile.id))
        .map((profile) => tokenizeHuggingFaceModel(text, profile)),
    );
    self.postMessage({ id, results });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Could not tokenize text.",
    });
  }
};
