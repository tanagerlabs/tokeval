import { describe, expect, it } from "vitest";
import {
  INITIAL_RESULTS,
  INITIAL_TEXT,
} from "../src/lib/initial-tokenization";
import { ENCODING_NAMES, tokenize } from "../src/lib/tokenizer";

it("keeps the static first render aligned with the pinned encodings", async () => {
  const currentResults = await Promise.all(
    ENCODING_NAMES.map((encoding) => tokenize(INITIAL_TEXT, encoding)),
  );

  expect(INITIAL_RESULTS).toEqual(currentResults);
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

