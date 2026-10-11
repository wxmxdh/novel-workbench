export function orderLongChapterNavigationItems<
  T extends { id: string; narrativeOrder?: number }
>(items: readonly T[]): T[] {
  if (items.some(({ narrativeOrder }) => narrativeOrder === undefined)) {
    return [...items];
  }
  return items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => {
      const leftOrder = left.item.narrativeOrder ?? 0;
      const rightOrder = right.item.narrativeOrder ?? 0;
      return leftOrder - rightOrder || left.sourceIndex - right.sourceIndex;
    })
    .map(({ item }) => item);
}
