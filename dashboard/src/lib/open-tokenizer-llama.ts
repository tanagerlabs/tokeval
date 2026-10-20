import { Tiktoken, type TiktokenBPE } from "js-tiktoken/lite";
import { OPEN_MODEL_PROFILES, type OpenModelTokenizerProfile } from "./open-model-profiles";
import {
  decodeBase64,
  decodeWholeToken,
  makeOpenModelResult,
  sha256Hex,
  utf8Encoder,
} from "./open-tokenizer-common";
import type { TokenPiece, TokenizationResult } from "./tokenizer";

interface LoadedTiktokenModel {
  encoder: Tiktoken;
  bytesByToken: Map<number, Uint8Array>;
}

const tokenizerCache = new Map<string, Promise<LoadedTiktokenModel>>();

async function loadTiktokenModel(
  profile: OpenModelTokenizerProfile,
): Promise<LoadedTiktokenModel> {
  const cached = tokenizerCache.get(profile.tokenizerId);
  if (cached) return cached;
  const pending = (async () => {
    if (!profile.artifactUrl || !profile.pattern) {
      throw new Error(`Missing tiktoken configuration for ${profile.label}.`);
    }
    const response = await fetch(profile.artifactUrl);
    if (!response.ok) {
      throw new Error(`Could not load ${profile.label} tokenizer (${response.status}).`);
    }
    const artifact = await response.arrayBuffer();
    if (
      profile.artifactSha256 &&
      (await sha256Hex(artifact)) !== profile.artifactSha256
    ) {
      throw new Error(`${profile.label} tokenizer checksum did not match.`);
    }
    const lines = new TextDecoder().decode(artifact).trim().split("\n");
    const bytesByToken = new Map<number, Uint8Array>();
    const packedRanks = lines.map((line) => {
      const [encodedBytes, rankText] = line.split(" ");
      const rank = Number.parseInt(rankText, 10);
      bytesByToken.set(rank, decodeBase64(encodedBytes));
      return `! ${rank} ${encodedBytes}`;
    });
    const ranks: TiktokenBPE = {
      pat_str: profile.pattern,
      special_tokens: {},
      bpe_ranks: packedRanks.join("\n"),
    };
    return { encoder: new Tiktoken(ranks), bytesByToken };
  })();
  tokenizerCache.set(profile.tokenizerId, pending);
  void pending.catch(() => {
    if (tokenizerCache.get(profile.tokenizerId) === pending) {
      tokenizerCache.delete(profile.tokenizerId);
    }
  });
  return pending;
}

export async function tokenizeLlamaModel(
  text: string,
  profile: OpenModelTokenizerProfile,
): Promise<TokenizationResult> {
  const { encoder, bytesByToken } = await loadTiktokenModel(profile);
  const ids = encoder.encode(text, [], []);
  const expectedBytes = utf8Encoder.encode(text);
  let cursor = 0;
  const tokens = ids.map((id, index): TokenPiece => {
    const bytes = bytesByToken.get(id);
    if (!bytes) throw new Error(`Missing byte data for token ${id} in ${profile.label}.`);
    const byteStart = cursor;
    cursor += bytes.length;
    return {
      index,
      id,
      bytes: Array.from(bytes),
      byteStart,
      byteEnd: cursor,
      text: decodeWholeToken(bytes),
    };
  });
  const reconstructed = tokens.flatMap((token) => token.bytes);
  if (
    reconstructed.length !== expectedBytes.length ||
    reconstructed.some((byte, index) => byte !== expectedBytes[index])
  ) {
    throw new Error(`${profile.label} tokenizer did not round-trip the input UTF-8 bytes.`);
  }
  return makeOpenModelResult(profile, expectedBytes.length, tokens);
}

export const LLAMA_MODEL_PROFILES = OPEN_MODEL_PROFILES.filter(
  (profile) => profile.decoder === "tiktoken",
);
