import { describe, expect, test } from "vitest";
import {
  tokenRowEnds,
  tokenRowEndsWithReservedWidth,
} from "../src/components/ProgressiveTokenOutput";

describe("progressive token rows", () => {
  test("records the exclusive token index at the end of every wrapped row", () => {
    expect(tokenRowEnds([0, 0, 0, 36, 36, 72, 72, 72, 108])).toEqual([
      3,
      5,
      8,
      9,
    ]);
  });

  test("tolerates sub-pixel position differences within one row", () => {
    expect(tokenRowEnds([10, 10.4, 10.8, 46, 46.2])).toEqual([3, 5]);
  });

  test("handles an empty token stream", () => {
    expect(tokenRowEnds([])).toEqual([]);
  });

  test("reserves room for the inline view-more control at the end of each row", () => {
    expect(tokenRowEndsWithReservedWidth(
      [0, 0, 0, 36, 36, 72, 72, 72],
      [30, 64, 96, 40, 85, 24, 62, 98],
      100,
      35,
    )).toEqual([2, 4, 7]);
  });
});
