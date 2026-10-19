import { describe, expect, it } from "vitest";
import {
  INITIAL_RESULTS,
  INITIAL_TEXT,
} from "../src/lib/initial-tokenization";
import {
  piecesFromTokenStrings,
} from "../src/lib/token-bytes";
import { ENCODING_NAMES, tokenize, tokenizeAll } from "../src/lib/tokenizer";

it("keeps the static first render aligned with the pinned encodings", async () => {
  const currentResults = await Promise.all(
    ENCODING_NAMES.map((encoding) => tokenize(INITIAL_TEXT, encoding)),
  );

  expect(INITIAL_RESULTS.slice(0, ENCODING_NAMES.length)).toEqual(
    currentResults,
  );
});

describe.each(ENCODING_NAMES)("%s tokenizer", (encoding) => {
  it("preserves the exact UTF-8 bytes and contiguous spans", async () => {
    const input = "한글과 emoji 👋🏽, café\nmixed!";
    const result = await tokenize(input, encoding);
    const reconstructed = result.tokens.flatMap((token) => token.bytes);

    expect(reconstructed).toEqual(Array.from(new TextEncoder().encode(input)));
    expect(result.tokens[0]?.byteStart).toBe(0);
    expect(result.tokens.at(-1)?.byteEnd).toBe(result.inputBytes);

    for (let index = 1; index < result.tokens.length; index += 1) {
      expect(result.tokens[index].byteStart).toBe(
        result.tokens[index - 1].byteEnd,
      );
    }
  });

  it("round-trips normalization forms without normalizing them", async () => {
    const composed = await tokenize("é", encoding);
    const decomposed = await tokenize("e\u0301", encoding);

    expect(composed.inputBytes).toBe(2);
    expect(decomposed.inputBytes).toBe(3);
    expect(composed.tokens.flatMap((token) => token.bytes)).not.toEqual(
      decomposed.tokens.flatMap((token) => token.bytes),
    );
  });

  it("handles empty input", async () => {
    const result = await tokenize("", encoding);

    expect(result.inputBytes).toBe(0);
    expect(result.tokens).toEqual([]);
  });
});

it("tokenizes only visible core model IDs when a selection is provided", async () => {
  const results = await tokenizeAll("Hello", ["openai-o200k"]);

  expect(results.map((result) => result.profile.id)).toEqual(["openai-o200k"]);
});

describe("open-model token byte reconstruction", () => {
  it("reverses byte-level BPE pieces without losing split code points", () => {
    const input = "오늘 👋🏽";
    const pieces = piecesFromTokenStrings(
      input,
      [1, 2, 3, 4, 5],
      ["ìĺ¤", "ëĬĺ", "ĠðŁĳ", "ĭ", "ðŁı½"],
      "byte_level",
    );

    expect(pieces.flatMap((piece) => piece.bytes)).toEqual(
      Array.from(new TextEncoder().encode(input)),
    );
    expect(pieces.some((piece) => piece.text === null)).toBe(true);
  });

  it("preserves SentencePiece byte fallback and a synthetic metaspace", () => {
    const input = "오늘 👋";
    const pieces = piecesFromTokenStrings(
      input,
      [1, 2, 3, 4, 5, 6, 7, 8],
      ["▁", "오", "늘", "▁", "<0xF0>", "<0x9F>", "<0x91>", "<0x8B>"],
      "sentencepiece",
    );

    expect(pieces.flatMap((piece) => piece.bytes)).toEqual(
      Array.from(new TextEncoder().encode(input)),
    );
  });

  it("does not strip a real leading input space", () => {
    const pieces = piecesFromTokenStrings(
      " hello",
      [1, 2],
      ["▁hell", "o"],
      "sentencepiece",
    );

    expect(pieces.flatMap((piece) => piece.bytes)).toEqual(
      Array.from(new TextEncoder().encode(" hello")),
    );
  });
});

