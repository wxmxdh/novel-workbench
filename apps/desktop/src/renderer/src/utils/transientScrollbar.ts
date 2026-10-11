export const TRANSIENT_SCROLLBAR_ACTIVE_CLASS = "is-scrollbar-active";
export const TRANSIENT_SCROLLBAR_HIDE_DELAY_MS = 800;

export function createTransientScrollbarController(
  hideDelayMs = TRANSIENT_SCROLLBAR_HIDE_DELAY_MS
): {
  reveal: (element: HTMLElement) => void;
  dispose: () => void;
} {
  let activeElement: HTMLElement | undefined;
  let hideTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  function clearHideTimer(): void {
    if (hideTimer === undefined) return;
    globalThis.clearTimeout(hideTimer);
    hideTimer = undefined;
  }

  function reveal(element: HTMLElement): void {
    if (activeElement && activeElement !== element) {
      activeElement.classList.remove(TRANSIENT_SCROLLBAR_ACTIVE_CLASS);
    }
    activeElement = element;
    activeElement.classList.add(TRANSIENT_SCROLLBAR_ACTIVE_CLASS);
    clearHideTimer();
    hideTimer = globalThis.setTimeout(() => {
      element.classList.remove(TRANSIENT_SCROLLBAR_ACTIVE_CLASS);
      if (activeElement === element) activeElement = undefined;
      hideTimer = undefined;
    }, hideDelayMs);
  }

  function dispose(): void {
    clearHideTimer();
    activeElement?.classList.remove(TRANSIENT_SCROLLBAR_ACTIVE_CLASS);
    activeElement = undefined;
  }

  return { reveal, dispose };
}
