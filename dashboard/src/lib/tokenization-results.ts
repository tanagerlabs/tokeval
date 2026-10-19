import type { TokenizationResult } from "./tokenizer";

function resultId(result: TokenizationResult): string {
  return result.profile.id || result.profile.encoding;
}

export function removeTokenizationResults(
  current: TokenizationResult[],
  groupIds: ReadonlySet<string>,
): TokenizationResult[] {
  return current.filter((result) => !groupIds.has(resultId(result)));
}

export function replaceTokenizationResults(
  current: TokenizationResult[],
  next: TokenizationResult[],
  groupIds: ReadonlySet<string>,
): TokenizationResult[] {
  return [...removeTokenizationResults(current, groupIds), ...next];
}
