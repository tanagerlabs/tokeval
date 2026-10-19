export interface EstimateWrapper {
  prefix: string;
  suffix: string;
}

// Multiple contexts reduce the chance that a tokenizer merge at either raw
// text boundary dominates the estimate. These are user-content measurement
// anchors, not hidden system instructions.
export const CONTENT_ESTIMATE_WRAPPERS: readonly EstimateWrapper[] = [
  { prefix: "<tokeval-content>\n", suffix: "\n</tokeval-content>" },
  { prefix: "--- TOKEVAL START ---\n\n", suffix: "\n\n--- TOKEVAL END ---" },
  { prefix: "[A]\n", suffix: "\n[B]" },
];

export interface ContentEstimate {
  value: number | null;
  minimum: number | null;
  maximum: number | null;
  successfulWrappers: number;
}

export function summarizeContentEstimate(
  outcomes: readonly PromiseSettledResult<number>[],
): ContentEstimate {
  const deltas = outcomes
    .flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : [])
    .sort((left, right) => left - right);

  return {
    value: deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)]! : null,
    minimum: deltas.length > 0 ? deltas[0]! : null,
    maximum: deltas.length > 0 ? deltas[deltas.length - 1]! : null,
    successfulWrappers: deltas.length,
  };
}
