import type { OpenModelTokenizerProfile } from "./open-model-profiles";
import type { TokenPiece, TokenizationResult } from "./tokenizer";

export const utf8Encoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeWholeToken(bytes: Uint8Array): string | null {
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

export async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function makeOpenModelResult(
  profile: OpenModelTokenizerProfile,
  inputBytes: number,
  tokens: TokenPiece[],
): TokenizationResult {
  return {
    profile,
    tokenizerRevision: `${profile.repository}@${profile.revision.slice(0, 8)}`,
    countSource: "local_tokenizer",
    inputBytes,
    tokens,
  };
}
