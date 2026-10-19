import { describe, expect, it } from "vitest";
import {
  hasCrossedSwapEdge,
  moveItem,
} from "../src/lib/model-order";

describe("model ordering", () => {
  it("moves a model upward without losing its neighbors", () => {
    expect(moveItem(["alpha", "beta", "gamma"], 2, 0)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("moves a model downward without mutating the current order", () => {
    const current = ["alpha", "beta", "gamma"];

    expect(moveItem(current, 0, 2)).toEqual(["beta", "gamma", "alpha"]);
    expect(current).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns an unchanged copy for an out-of-range move", () => {
    const current = ["alpha", "beta"];
    const next = moveItem(current, 0, 3);

    expect(next).toEqual(current);
    expect(next).not.toBe(current);
  });
});

describe("drag swap threshold", () => {
  it("swaps downward when the leading edge enters the top of the next row", () => {
    expect(hasCrossedSwapEdge(1, 43, 80, 100, 100)).toBe(true);
    expect(hasCrossedSwapEdge(1, 41, 80, 100, 100)).toBe(false);
  });

  it("swaps upward when the leading edge enters the bottom of the previous row", () => {
    expect(hasCrossedSwapEdge(-1, 77, 80, 0, 100)).toBe(true);
    expect(hasCrossedSwapEdge(-1, 79, 80, 0, 100)).toBe(false);
  });
});
