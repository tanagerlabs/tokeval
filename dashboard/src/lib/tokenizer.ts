import { Tiktoken, type TiktokenBPE } from "js-tiktoken/lite";
import { CORE_CATALOG_MODELS } from "./catalog";
import type { ModelKind } from "./catalog";

export const ENCODING_NAMES = ["o200k_base", "cl100k_base"] as const;

export type EncodingName = (typeof ENCODING_NAMES)[number];

export type TokenizerProvider = string;

export interface TokenizerProfile {
  id: string;
  kind?: ModelKind;
  tokenizerId?: string;
  provider: TokenizerProvider;
  encoding: string;
  label: string;
  modelExamples: string;
  accent: "coral" | "blue";
  sourceUrl?: string;
  supportsBoundaries?: boolean;
  artifactSizeBytes?: number;
  boundaryLimitation?: string;
}

export interface TokenPiece {
  index: number;
  id: number;
  bytes: number[];
  byteStart: number;
  byteEnd: number;
  text: string | null;
}

export interface TokenizationResult {
  profile: TokenizerProfile;
  tokenizerRevision: string;
  countSource: "local_tokenizer";
  inputBytes: number;
  tokens: TokenPiece[];
  /** Exact total when a tokenizer cannot expose lossless raw-input boundaries. */
  tokenCount?: number;
}

export const TOKENIZER_PROFILES = Object.fromEntries(
  CORE_CATALOG_MODELS
    .filter((model) => model.id === model.tokenizerId)
    .map(({ kind: _kind, tokenizerId: _tokenizerId, ...model }) => [model.encoding, model]),
) as Record<EncodingName, TokenizerProfile>;

interface LoadedEncoding {
  encoder: Tiktoken;
  bytesByToken: Map<number, Uint8Array>;
}

const encoderCache = new Map<EncodingName, Promise<LoadedEncoding>>();
const utf8Encoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function createByteLookup(ranks: TiktokenBPE): Map<number, Uint8Array> {
  const lookup = new Map<number, Uint8Array>();

  for (const line of ranks.bpe_ranks.split("\n")) {
    if (!line) continue;
    const [, offsetText, ...encodedTokens] = line.split(" ");
    const offset = Number.parseInt(offsetText, 10);

    encodedTokens.forEach((encodedBytes, index) => {
      lookup.set(offset + index, decodeBase64(encodedBytes));
    });
  }

  return lookup;
}

async function loadEncoding(encoding: EncodingName): Promise<LoadedEncoding> {
  const cached = encoderCache.get(encoding);
  if (cached) return cached;

  const pending = (async () => {
    const ranks =
      encoding === "o200k_base"
        ? (await import("js-tiktoken/ranks/o200k_base")).default
        : (await import("js-tiktoken/ranks/cl100k_base")).default;

    return {
      encoder: new Tiktoken(ranks),
      bytesByToken: createByteLookup(ranks),
    };
  })();

  encoderCache.set(encoding, pending);
  try {
    return await pending;
  } catch (error) {
    // A stale deployment chunk or transient download failure must not poison
    // every later attempt in this browser session.
    if (encoderCache.get(encoding) === pending) encoderCache.delete(encoding);
    throw error;
  }
}

function decodeWholeToken(bytes: Uint8Array): string | null {
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

export async function tokenize(
  text: string,
  encoding: EncodingName,
): Promise<TokenizationResult> {
  const { encoder, bytesByToken } = await loadEncoding(encoding);
  const tokenIds = encoder.encode(text, [], []);
  const expectedBytes = utf8Encoder.encode(text);
  let cursor = 0;

  const tokens = tokenIds.map((id, index): TokenPiece => {
    const bytes = bytesByToken.get(id);
    if (!bytes) {
      throw new Error(`Missing byte data for token ${id} in ${encoding}.`);
    }

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

  if (
    cursor !== expectedBytes.length ||
    tokens.some((token) =>
      token.bytes.some(
        (byte, offset) => byte !== expectedBytes[token.byteStart + offset],
      ),
    )
  ) {
    throw new Error(`Token bytes did not round-trip for ${encoding}.`);
  }

  return {
    profile: TOKENIZER_PROFILES[encoding],
    tokenizerRevision: "js-tiktoken@1.0.21",
    countSource: "local_tokenizer",
    inputBytes: expectedBytes.length,
    tokens,
  };
}

export async function tokenizeAll(
  text: string,
  profileIds: readonly string[] = ENCODING_NAMES.map(
    (encoding) => TOKENIZER_PROFILES[encoding].id,
  ),
): Promise<TokenizationResult[]> {
  const selected = new Set(profileIds);
  const profiles = CORE_CATALOG_MODELS.filter((profile) => selected.has(profile.id));
  const byEncoding = new Map<EncodingName, Promise<TokenizationResult>>();
  return Promise.all(profiles.map(async (profile) => {
    const encoding = profile.encoding as EncodingName;
    let pending = byEncoding.get(encoding);
    if (!pending) {
      pending = tokenize(text, encoding);
      byEncoding.set(encoding, pending);
    }
    const result = await pending;
    return profile.id === profile.tokenizerId ? result : { ...result, profile };
  }));
}

