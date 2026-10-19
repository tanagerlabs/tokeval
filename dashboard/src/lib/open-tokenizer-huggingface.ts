import { OPEN_MODEL_PROFILES, type OpenModelTokenizerProfile } from "./open-model-profiles";
import { makeOpenModelResult, utf8Encoder } from "./open-tokenizer-common";
import { piecesFromTokenStrings } from "./token-bytes";
import type { TokenizationResult } from "./tokenizer";

interface HuggingFaceEncoding {
  ids: number[];
  tokens: string[];
}

interface HuggingFaceTokenizer {
  encode(text: string, options: { add_special_tokens: boolean }): HuggingFaceEncoding;
}

const tokenizerCache = new Map<string, Promise<HuggingFaceTokenizer>>();

async function loadTokenizer(
  profile: OpenModelTokenizerProfile,
): Promise<HuggingFaceTokenizer> {
  const cached = tokenizerCache.get(profile.id);
  if (cached) return cached;

  const pending = (async () => {
    const { Tokenizer } = await import("@huggingface/tokenizers");
    const baseUrl = `https://huggingface.co/${profile.repository}/resolve/${profile.revision}`;
    const [tokenizerResponse, configResponse] = await Promise.all([
      fetch(`${baseUrl}/tokenizer.json`),
      fetch(`${baseUrl}/tokenizer_config.json`),
    ]);
    if (!tokenizerResponse.ok) {
      throw new Error(
        `Could not load ${profile.label} tokenizer (${tokenizerResponse.status}).`,
      );
    }
    const tokenizerJson = await tokenizerResponse.json();
    const tokenizerConfig = configResponse.ok ? await configResponse.json() : {};
    return new Tokenizer(tokenizerJson, tokenizerConfig) as HuggingFaceTokenizer;
  })();

  tokenizerCache.set(profile.id, pending);
  void pending.catch(() => {
    if (tokenizerCache.get(profile.id) === pending) tokenizerCache.delete(profile.id);
  });
  return pending;
}

export async function tokenizeHuggingFaceModel(
  text: string,
  profile: OpenModelTokenizerProfile,
): Promise<TokenizationResult> {
  const tokenizer = await loadTokenizer(profile);
  const encoded = tokenizer.encode(text, { add_special_tokens: false });
  const tokens = piecesFromTokenStrings(
    text,
    encoded.ids,
    encoded.tokens,
    profile.decoder === "sentencepiece" ? "sentencepiece" : "byte_level",
  );
  return makeOpenModelResult(profile, utf8Encoder.encode(text).length, tokens);
}

export const HUGGINGFACE_MODEL_PROFILES = OPEN_MODEL_PROFILES.filter(
  (profile) => profile.decoder === "byte_level" || profile.decoder === "sentencepiece",
);
