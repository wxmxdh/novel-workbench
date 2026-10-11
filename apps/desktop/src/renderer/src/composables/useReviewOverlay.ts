import { ref } from "vue";
import { uiMessage } from "../ui-feedback";

/** Coordinate host DOM overlays with the review's native child view. */
export function useReviewOverlay() {
  const preview = ref<string | null>(null);
  const paused = ref(false);
  let observer: MutationObserver | undefined;
  let visible = false;
  let revision = 0;
  let stopped = true;
  const synchronize = () => {
    const next = Boolean(
      document.querySelector(
        '.popup-select-menu, [aria-modal="true"], dialog[open]'
      )
    );
    if (next === visible || stopped) return;
    visible = next;
    paused.value = next;
    const current = ++revision;
    const api = window.deepwrite?.otter;
    if (!next) preview.value = null;
    void api
      ?.setReviewOverlay(next)
      .then((result) => {
        if (!stopped && current === revision && visible)
          preview.value = result.preview;
      })
      .catch(() => {
        if (!stopped && current === revision)
          uiMessage.error("阅读菜单未能显示，请关闭后重试。");
      });
  };
  function observe() {
    stopped = false;
    observer = new MutationObserver(synchronize);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open", "aria-modal"]
    });
    synchronize();
  }
  function stop() {
    stopped = true;
    revision++;
    observer?.disconnect();
    observer = undefined;
    preview.value = null;
    paused.value = false;
    if (visible)
      void window.deepwrite?.otter?.setReviewOverlay(false).catch(() => {});
    visible = false;
  }
  return { preview, paused, observe, stop };
}
