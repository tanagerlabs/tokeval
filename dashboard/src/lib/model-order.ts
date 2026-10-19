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
