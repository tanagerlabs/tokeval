import { Tiktoken, type TiktokenBPE } from "js-tiktoken/lite";
import {
  OPEN_MODEL_PROFILES,
  type OpenModelTokenizerProfile,
} from "./open-model-profiles";
import { piecesFromTokenStrings } from "./token-bytes";
import type { TokenPiece, TokenizationResult } from "./tokenizer";

interface HuggingFaceEncoding {
  ids: number[];
  tokens: string[];
}

interface HuggingFaceTokenizer {
  encode(
    text: string,
    options: { add_special_tokens: boolean },
  ): HuggingFaceEncoding;
}

interface LoadedLlamaTokenizer {
  encoder: Tiktoken;
  bytesByToken: Map<number, Uint8Array>;
}

interface NativeSentencePieceTokenizer {
  loadFromB64StringModel(model: string): Promise<void>;
  encodeIds(text: string): number[];
  encodePieces(text: string): string[];
}

const tokenizerCache = new Map<string, Promise<HuggingFaceTokenizer>>();
let llamaTokenizer: Promise<LoadedLlamaTokenizer> | undefined;
const nativeSentencePieceTokenizers = new Map<
  string,
  Promise<NativeSentencePieceTokenizer>
>();
const utf8Encoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function decodeWholeToken(bytes: Uint8Array): string | null {
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

async function loadHuggingFaceTokenizer(
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
    const tokenizerConfig = configResponse.ok
      ? await configResponse.json()
      : {};
    return new Tokenizer(tokenizerJson, tokenizerConfig) as HuggingFaceTokenizer;
  })();

  tokenizerCache.set(profile.id, pending);
  void pending.catch(() => {
    if (tokenizerCache.get(profile.id) === pending) {
      tokenizerCache.delete(profile.id);
    }
  });
  return pending;
}

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
    const { default: o200kRanks } = await import(
      "js-tiktoken/ranks/o200k_base"
    );
    const ranks: TiktokenBPE = {
      // Llama 4's reference tokenizer uses the same pre-tokenization pattern
      // as o200k, but its own pinned merge ranks and token IDs.
      pat_str: o200kRanks.pat_str,
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

async function loadNativeSentencePieceTokenizer(
  profile: OpenModelTokenizerProfile,
): Promise<NativeSentencePieceTokenizer> {
  const cached = nativeSentencePieceTokenizers.get(profile.id);
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
    if (
      profile.artifactSha256 &&
      await sha256Hex(model) !== profile.artifactSha256
    ) {
      throw new Error(`${profile.label} tokenizer failed its SHA-256 check.`);
    }

    const { SentencePieceProcessor } = await import(
      "@sctg/sentencepiece-js"
    );
    const tokenizer = new SentencePieceProcessor();
    await tokenizer.loadFromB64StringModel(
      encodeBase64(model),
    );
    return tokenizer;
  })();

  nativeSentencePieceTokenizers.set(profile.id, pending);
  void pending.catch(() => {
    if (nativeSentencePieceTokenizers.get(profile.id) === pending) {
      nativeSentencePieceTokenizers.delete(profile.id);
    }
  });
  return pending;
}

function revisionLabel(profile: OpenModelTokenizerProfile): string {
  return `${profile.repository}@${profile.revision.slice(0, 8)}`;
}

function makeResult(
  profile: OpenModelTokenizerProfile,
  inputBytes: number,
  tokens: TokenPiece[],
): TokenizationResult {
  return {
    profile,
    tokenizerRevision: revisionLabel(profile),
    countSource: "local_tokenizer",
    inputBytes,
    tokens,
  };
}

async function tokenizeHuggingFace(
  text: string,
  profile: OpenModelTokenizerProfile,
): Promise<TokenizationResult> {
  const tokenizer = await loadHuggingFaceTokenizer(profile);
  const encoded = tokenizer.encode(text, {
    add_special_tokens: false,
  });
  const tokens = piecesFromTokenStrings(
    text,
    encoded.ids,
    encoded.tokens,
    profile.decoder === "sentencepiece" ? "sentencepiece" : "byte_level",
  );

  return makeResult(profile, utf8Encoder.encode(text).length, tokens);
}

async function tokenizeLlama(
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

  return makeResult(profile, expectedBytes.length, tokens);
}

async function tokenizeNativeSentencePiece(
  text: string,
  profile: OpenModelTokenizerProfile,
): Promise<TokenizationResult> {
  const tokenizer = await loadNativeSentencePieceTokenizer(profile);
  const ids = tokenizer.encodeIds(text);
  const tokens = piecesFromTokenStrings(
    text,
    ids,
    tokenizer.encodePieces(text),
    "sentencepiece",
  );

  return makeResult(profile, utf8Encoder.encode(text).length, tokens);
}

export async function tokenizeOpenModels(
  text: string,
  profileIds?: readonly string[],
): Promise<TokenizationResult[]> {
  const selectedIds = profileIds ? new Set(profileIds) : null;
  return Promise.all(
    OPEN_MODEL_PROFILES
      .filter((profile) => !selectedIds || selectedIds.has(profile.id))
      .map((profile) => {
        if (profile.decoder === "tiktoken") return tokenizeLlama(text, profile);
        if (profile.decoder === "native_sentencepiece") {
          return tokenizeNativeSentencePiece(text, profile);
        }
        return tokenizeHuggingFace(text, profile);
      }),
  );
}

