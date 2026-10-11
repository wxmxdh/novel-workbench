import {
  OTTER_REVIEW_COLOR_KEYS,
  OtterReviewThemeSchema
} from "@deepwrite/contracts/renderer";
import { onBeforeUnmount } from "vue";

/** The embedded view receives only the parent window's resolved palette. */
export function useReviewTheme() {
  let observer: MutationObserver | undefined;
  let frame = 0;
  let lastTheme = "";
  let pending: Promise<void> = Promise.resolve();
  let disposed = false;
  async function synchronize() {
    const api = window.deepwrite?.otter;
    if (!api) return;
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const theme = OtterReviewThemeSchema.safeParse({
      scheme: root.dataset.theme === "dark" ? "dark" : "light",
      colors: Object.fromEntries(
        OTTER_REVIEW_COLOR_KEYS.map((key) => [
          key,
          style.getPropertyValue(`--${key}`).trim()
        ])
      )
    });
    if (!theme.success) return;
    const serialized = JSON.stringify(theme.data);
    if (serialized === lastTheme) return;
    pending = pending
      .catch(() => {})
      .then(async () => {
        if (disposed || serialized === lastTheme) return;
        await api.setReviewTheme(theme.data);
        lastTheme = serialized;
      });
    await pending;
  }
  function observe() {
    observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void synchronize().catch(() =>
          console.warn("Review theme synchronization failed.")
        );
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme"]
    });
  }
  onBeforeUnmount(() => {
    disposed = true;
    observer?.disconnect();
    cancelAnimationFrame(frame);
  });
  return { synchronize, observe };
}
