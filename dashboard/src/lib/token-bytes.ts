import type { TokenPiece } from "./tokenizer";

export type TokenDecoder = "byte_level" | "sentencepiece";

const utf8Encoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function buildByteLevelDecoder(): Map<number, number> {
  const bytes = [
    ...range(33, 127),
    ...range(161, 173),
    ...range(174, 256),
  ];
  const characters = [...bytes];
  let offset = 0;

  for (let byte = 0; byte < 256; byte += 1) {
    if (bytes.includes(byte)) continue;
    bytes.push(byte);
    characters.push(256 + offset);
    offset += 1;
  }

  return new Map(characters.map((character, index) => [character, bytes[index]]));
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, index) => start + index);
}

const byteLevelDecoder = buildByteLevelDecoder();

export function byteLevelTokenBytes(token: string): number[] {
  return Array.from(token, (character) => {
    const byte = byteLevelDecoder.get(character.codePointAt(0) ?? -1);
    if (byte === undefined) {
      throw new Error(`Unknown byte-level token character: ${character}`);
    }
    return byte;
  });
}

export function sentencePieceTokenBytes(token: string): number[] {
  const byteFallback = /^<0x([0-9A-Fa-f]{2})>$/.exec(token);
  if (byteFallback) return [Number.parseInt(byteFallback[1], 16)];

  return Array.from(utf8Encoder.encode(token.replaceAll("▁", " ")));
}

function decodeWholeToken(bytes: number[]): string | null {
  try {
    return fatalUtf8Decoder.decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

function arraysEqual(left: number[], right: number[]): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

export function piecesFromTokenStrings(
  text: string,
  ids: number[],
  tokenStrings: string[],
  decoder: TokenDecoder,
): TokenPiece[] {
  if (ids.length !== tokenStrings.length) {
    throw new Error("Tokenizer returned mismatched token IDs and pieces.");
  }

  const expectedBytes = Array.from(utf8Encoder.encode(text));
  const bytesByToken = tokenStrings.map((token) =>
    decoder === "byte_level"
      ? byteLevelTokenBytes(token)
      : sentencePieceTokenBytes(token),
  );
  let reconstructed = bytesByToken.flat();

  // SentencePiece commonly prepends one metaspace marker and strips it during
  // decode. Remove it only when it is demonstrably synthetic; a real leading
  // input space remains attached to the first token.
  if (
    !arraysEqual(reconstructed, expectedBytes) &&
    reconstructed[0] === 0x20 &&
    arraysEqual(reconstructed.slice(1), expectedBytes)
  ) {
    const firstBytes = bytesByToken.find((bytes) => bytes.length > 0);
    firstBytes?.shift();
    reconstructed = bytesByToken.flat();
  }

  if (!arraysEqual(reconstructed, expectedBytes)) {
    throw new Error("Tokenizer pieces did not round-trip the input UTF-8 bytes.");
  }

  let cursor = 0;
  return ids.map((id, index) => {
    const bytes = bytesByToken[index];
    const byteStart = cursor;
    cursor += bytes.length;

    return {
      index,
      id,
      bytes,
      byteStart,
      byteEnd: cursor,
      text: decodeWholeToken(bytes),
    };
  });
}

