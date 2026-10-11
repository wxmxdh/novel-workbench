import type { LongWorkspaceIndexSnapshot } from "../long-workspace";

export function nextOrder(values: readonly number[]): number {
  let max = 0;
  for (const value of values) {
    if (value > max) max = value;
  }
  return max + 1;
}

export function normalizeStoryPlotOrders(
  workspace: LongWorkspaceIndexSnapshot
): void {
  const arcPosition = new Map(
    workspace.plot.arcs.map((arc, index) => [arc.id, index])
  );
  workspace.plot.storyPlots.sort(
    (left, right) =>
      (arcPosition.get(left.arcId) ?? Number.MAX_SAFE_INTEGER) -
        (arcPosition.get(right.arcId) ?? Number.MAX_SAFE_INTEGER) ||
      left.order - right.order
  );
  const storyPlotOrder = new Map<string, number>();
  workspace.plot.storyPlots.forEach((storyPlot) => {
    const next = (storyPlotOrder.get(storyPlot.arcId) ?? 0) + 1;
    storyPlotOrder.set(storyPlot.arcId, next);
    storyPlot.order = next;
  });
}
