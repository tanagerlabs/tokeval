import { OPEN_MODEL_PROFILES, type OpenModelTokenizerProfile } from "./open-model-profiles";
import { makeOpenModelResult, sha256Hex, utf8Encoder } from "./open-tokenizer-common";
import { piecesFromTokenStrings } from "./token-bytes";
import type { TokenizationResult } from "./tokenizer";

interface NativeSentencePieceTokenizer {
  _loadModel(model: Uint8Array): Promise<void>;
  encodeIds(text: string): number[];
  encodePieces(text: string): string[];
}

const tokenizers = new Map<string, Promise<NativeSentencePieceTokenizer>>();

async function loadTokenizer(
  profile: OpenModelTokenizerProfile,
): Promise<NativeSentencePieceTokenizer> {
  const cached = tokenizers.get(profile.tokenizerId);
  if (cached) return cached;
  const pending = (async () => {
    if (!profile.artifactUrl) {
      throw new Error(`Missing ${profile.label} tokenizer URL.`);
    }
    const response = await fetch(profile.artifactUrl);
    if (!response.ok) {
      throw new Error(
        `Could not load ${profile.label} tokenizer (${response.status}).`,
      );
    }
    const model = await response.arrayBuffer();
    if (profile.artifactSha256 && await sha256Hex(model) !== profile.artifactSha256) {
      throw new Error(`${profile.label} tokenizer failed its SHA-256 check.`);
    }
    const { SentencePieceProcessor } = await import("@sctg/sentencepiece-js");
    const tokenizer = new SentencePieceProcessor() as unknown as NativeSentencePieceTokenizer;
    // The pinned package's public loader converts base64 back into bytes. Its
    // byte-oriented loader avoids both conversions and their temporary copies.
    await tokenizer._loadModel(new Uint8Array(model));
    return tokenizer;
  })();
  tokenizers.set(profile.tokenizerId, pending);
  void pending.catch(() => {
    if (tokenizers.get(profile.tokenizerId) === pending) {
      tokenizers.delete(profile.tokenizerId);
    }
  });
  return pending;
}

export async function tokenizeSentencePieceModel(
  text: string,
  profile: OpenModelTokenizerProfile,
): Promise<TokenizationResult> {
  const tokenizer = await loadTokenizer(profile);
  const ids = tokenizer.encodeIds(text);
  const tokens = piecesFromTokenStrings(
    text,
    ids,
    tokenizer.encodePieces(text),
    "sentencepiece",
  );
  return makeOpenModelResult(profile, utf8Encoder.encode(text).length, tokens);
}

export const SENTENCEPIECE_MODEL_PROFILES = OPEN_MODEL_PROFILES.filter(
  (profile) => profile.decoder === "native_sentencepiece",
);
