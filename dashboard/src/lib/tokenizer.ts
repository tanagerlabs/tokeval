import { Tiktoken, type TiktokenBPE } from "js-tiktoken/lite";

export const ENCODING_NAMES = ["o200k_base", "cl100k_base"] as const;

export type EncodingName = (typeof ENCODING_NAMES)[number];

export type TokenizerProvider =
  | "openai"
  | "deepseek"
  | "meta"
  | "mistral"
  | "cohere"
  | "xai";

export interface TokenizerProfile {
  id: string;
  provider: TokenizerProvider;
  encoding: string;
  label: string;
  modelExamples: string;
  accent: "coral" | "blue";
  sourceUrl?: string;
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
}

export const TOKENIZER_PROFILES: Record<EncodingName, TokenizerProfile> = {
  o200k_base: {
    id: "openai-o200k",
    provider: "openai",
    encoding: "o200k_base",
    label: "OpenAI o200k",
    modelExamples: "GPT-4o · GPT-4.1 · GPT-5",
    accent: "coral",
  },
  cl100k_base: {
    id: "openai-cl100k",
    provider: "openai",
    encoding: "cl100k_base",
    label: "OpenAI cl100k",
    modelExamples: "GPT-4 · GPT-4 Turbo",
    accent: "blue",
  },
};

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
  return pending;
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

export async function tokenizeAll(text: string): Promise<TokenizationResult[]> {
  return Promise.all(ENCODING_NAMES.map((encoding) => tokenize(text, encoding)));
}

