/// <reference lib="webworker" />

import { tokenizeOpenModels } from "./open-model-tokenizers";

interface TokenizeRequest {
  id: number;
  text: string;
}

self.onmessage = async (event: MessageEvent<TokenizeRequest>) => {
  const { id, text } = event.data;

  try {
    const results = await tokenizeOpenModels(text);
    self.postMessage({ id, results });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Could not tokenize text.",
    });
  }
};

