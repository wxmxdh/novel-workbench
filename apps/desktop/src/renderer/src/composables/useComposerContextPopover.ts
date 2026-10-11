import {
  onBeforeUnmount,
  onMounted,
  ref,
  type CSSProperties,
  type Ref
} from "vue";

/** Keep the context picker attached to its trigger without covering the workspace. */
export function useComposerContextPopover(
  anchor: () => HTMLElement,
  panel: Ref<HTMLElement | undefined>,
  dismiss: () => void
) {
  const style = ref<CSSProperties>({ visibility: "hidden" });
  let restoreFocus = true;
  let observer: ResizeObserver | undefined;
  let frame = 0;
  function position(): void {
    const rect = anchor().getBoundingClientRect();
    const margin = 8;
    const gap = 7;
    const width = Math.min(320, window.innerWidth - margin * 2);
    const above = Math.max(0, rect.top - gap - margin);
    const below = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
    const upward = above >= 260 || above > below;
    style.value = {
      position: "fixed",
      width: `${width}px`,
      left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`,
      ...(upward
        ? { bottom: `${window.innerHeight - rect.top + gap}px` }
        : { top: `${rect.bottom + gap}px` }),
      maxHeight: `${Math.min(380, upward ? above : below)}px`,
      transformOrigin: upward ? "bottom left" : "top left"
    };
  }
  function schedulePosition(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  }
  function outside(event: Event): void {
    const target = event.target;
    if (
      target instanceof Node &&
      !panel.value?.contains(target) &&
      !anchor().contains(target)
    ) {
      restoreFocus = false;
      dismiss();
    }
  }
  function close(): void {
    dismiss();
  }
  function tab(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const items = Array.from(
      panel.value?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)"
      ) ?? []
    );
    if (document.activeElement === (event.shiftKey ? items[0] : items.at(-1))) {
      // Let the browser continue from the trigger into the surrounding workspace.
      anchor().focus();
      dismiss();
    }
  }
  onMounted(() => {
    position();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", schedulePosition, true);
    window.addEventListener("resize", schedulePosition);
    observer = new ResizeObserver(schedulePosition);
    observer.observe(anchor());
    if (panel.value) observer.observe(panel.value);
  });
  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("focusin", outside);
    document.removeEventListener("scroll", schedulePosition, true);
    window.removeEventListener("resize", schedulePosition);
    observer?.disconnect();
    cancelAnimationFrame(frame);
    if (
      restoreFocus &&
      panel.value?.contains(document.activeElement) &&
      anchor().isConnected
    )
      anchor().focus();
  });
  return { style, close, tab };
}
