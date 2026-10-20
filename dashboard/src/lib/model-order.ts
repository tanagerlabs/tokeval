export function moveItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/**
 * Sorts available counts from lowest to highest. Missing counts stay at the
 * end, and ties retain the caller's order so manual ordering remains useful.
 */
export function rankModelIdsByCount(
  modelIds: readonly string[],
  counts: ReadonlyMap<string, number>,
): string[] {
  return modelIds
    .map((id, index) => ({ id, index, count: counts.get(id) }))
    .sort((left, right) => {
      const leftCount = left.count ?? Number.POSITIVE_INFINITY;
      const rightCount = right.count ?? Number.POSITIVE_INFINITY;
      return leftCount - rightCount || left.index - right.index;
    })
    .map(({ id }) => id);
}

export function hasCrossedSwapEdge(
  direction: -1 | 1,
  activeTop: number,
  activeHeight: number,
  neighborTop: number,
  neighborHeight: number,
  edgeRatio = 0.22,
  maximumEdgeDistance = 32,
): boolean {
  const edgeDistance = Math.min(
    maximumEdgeDistance,
    neighborHeight * edgeRatio,
  );

  return direction < 0
    ? activeTop < neighborTop + neighborHeight - edgeDistance
    : activeTop + activeHeight > neighborTop + edgeDistance;
}
