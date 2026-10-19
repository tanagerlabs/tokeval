import { Tiktoken, type TiktokenBPE } from "js-tiktoken/lite";
import { OPEN_MODEL_PROFILES, type OpenModelTokenizerProfile } from "./open-model-profiles";
import {
  decodeBase64,
  decodeWholeToken,
  makeOpenModelResult,
  utf8Encoder,
} from "./open-tokenizer-common";
import type { TokenPiece, TokenizationResult } from "./tokenizer";

interface LoadedLlamaTokenizer {
  encoder: Tiktoken;
  bytesByToken: Map<number, Uint8Array>;
}

// Pinned from js-tiktoken@1.0.21's o200k_base. Llama 4 uses this same
// pre-tokenization expression, but has its own merge ranks and token IDs.
const LLAMA_4_PATTERN = "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+('s|'S|'t|'T|'re|'rE|'Re|'RE|'ve|'vE|'Ve|'VE|'m|'M|'ll|'lL|'Ll|'LL|'d|'D)?|[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*('s|'S|'t|'T|'re|'rE|'Re|'RE|'ve|'vE|'Ve|'VE|'m|'M|'ll|'lL|'Ll|'LL|'d|'D)?|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+";

let llamaTokenizer: Promise<LoadedLlamaTokenizer> | undefined;

async function loadLlamaTokenizer(
  profile: OpenModelTokenizerProfile,
): Promise<LoadedLlamaTokenizer> {
  if (llamaTokenizer) return llamaTokenizer;
  const pending = (async () => {
    if (!profile.artifactUrl) throw new Error("Missing Llama tokenizer URL.");
    const response = await fetch(profile.artifactUrl);
    if (!response.ok) {
      throw new Error(`Could not load Llama tokenizer (${response.status}).`);
    }
    const lines = (await response.text()).trim().split("\n");
    const bytesByToken = new Map<number, Uint8Array>();
    const packedRanks = lines.map((line) => {
      const [encodedBytes, rankText] = line.split(" ");
      const rank = Number.parseInt(rankText, 10);
      bytesByToken.set(rank, decodeBase64(encodedBytes));
      return `! ${rank} ${encodedBytes}`;
    });
    const ranks: TiktokenBPE = {
      pat_str: LLAMA_4_PATTERN,
      special_tokens: {},
      bpe_ranks: packedRanks.join("\n"),
    };
    return { encoder: new Tiktoken(ranks), bytesByToken };
  })();
  llamaTokenizer = pending;
  void pending.catch(() => {
    if (llamaTokenizer === pending) llamaTokenizer = undefined;
  });
  return pending;
}

export async function tokenizeLlamaModel(
  text: string,
  profile: OpenModelTokenizerProfile,
): Promise<TokenizationResult> {
  const { encoder, bytesByToken } = await loadLlamaTokenizer(profile);
  const ids = encoder.encode(text, [], []);
  const expectedBytes = utf8Encoder.encode(text);
  let cursor = 0;
  const tokens = ids.map((id, index): TokenPiece => {
    const bytes = bytesByToken.get(id);
    if (!bytes) throw new Error(`Missing Llama byte data for token ${id}.`);
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
    throw new Error("Llama tokenizer did not round-trip the input UTF-8 bytes.");
  }
  return makeOpenModelResult(profile, expectedBytes.length, tokens);
}

export const LLAMA_MODEL_PROFILES = OPEN_MODEL_PROFILES.filter(
  (profile) => profile.decoder === "tiktoken",
);
