export interface ScrollableMenu {
  clientHeight: number;
  contains(node: unknown): boolean;
  getBoundingClientRect(): Pick<DOMRect, "height" | "top">;
  scrollHeight: number;
  scrollTop: number;
}

export function scrollSelectedIntoView(
  scroller: ScrollableMenu | null | undefined,
  selected: Pick<ScrollableMenu, "getBoundingClientRect"> | null | undefined
): void {
  if (!scroller || !selected || !scroller.contains(selected)) {
    return;
  }
  const selectedRect = selected.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  if (scrollerRect.height <= 0) {
    return;
  }
  const nextScrollTop =
    scroller.scrollTop +
    selectedRect.top -
    scrollerRect.top -
    (scroller.clientHeight - selectedRect.height) / 2;
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0, Math.min(nextScrollTop, maxScroll));
}
