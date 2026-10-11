<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { createScopedTranslator } from "../../i18n";
import { uiMessage } from "../../ui-feedback";
import { useLayoutStore } from "../../stores/layoutStore";
import { formatError } from "../../i18n/errors";
import { useReviewTheme } from "../../composables/useReviewTheme";
import { useReviewOverlay } from "../../composables/useReviewOverlay";

const t = createScopedTranslator("components.otterWorkbench");
const host = ref<HTMLElement | null>(null);
const ready = ref(false);
const reviewUrl = ref("");
const layout = useLayoutStore();
const focused = ref(false);
const fullscreen = ref(false);
const reviewTheme = useReviewTheme();
const reviewOverlay = useReviewOverlay();
const overlayPreview = reviewOverlay.preview;
const overlayPaused = reviewOverlay.paused;
let disposed = false;
let stateRevision = 0;
let previousLeftCollapsed = false;
function synchronizeFullscreen(value: boolean) {
  fullscreen.value = value;
}
let stopWindowState: (() => void) | undefined;
function toggleFocus() {
  if (!focused.value) {
    previousLeftCollapsed = layout.leftCollapsed;
    layout.leftCollapsed = true;
  } else layout.leftCollapsed = previousLeftCollapsed;
  focused.value = !focused.value;
}
async function toggleFullscreen() {
  try {
    const revision = stateRevision;
    const state =
      await window.deepwrite?.windowFrame?.command("toggleFullscreen");
    if (!disposed && state && revision === stateRevision)
      synchronizeFullscreen(state.fullscreen);
  } catch (error) {
    uiMessage.error(formatError(error, "无法切换全屏"));
  }
}
let observer: ResizeObserver | undefined;

async function setBounds(): Promise<void> {
  const api = window.deepwrite?.otter;
  const element = host.value;
  if (!api || !element || !ready.value || disposed) return;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    await api.setReviewBounds(null).catch(() => {});
    return;
  }
  await api
    .setReviewBounds({
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    })
    .catch((reason: unknown) => {
      uiMessage.error(
        reason instanceof Error ? reason.message : String(reason)
      );
    });
}

onMounted(async () => {
  stopWindowState = window.deepwrite?.windowFrame?.subscribe((state) => {
    stateRevision++;
    synchronizeFullscreen(state.fullscreen);
    void nextTick(setBounds);
  });
  const api = window.deepwrite?.otter;
  if (!api) {
    uiMessage.error(t("apiUnavailable"));
    return;
  }
  try {
    const revision = stateRevision;
    const state = await window.deepwrite?.windowFrame?.command("state");
    if (disposed) return;
    if (state && revision === stateRevision)
      synchronizeFullscreen(state.fullscreen);
    reviewTheme.observe();
    await reviewTheme.synchronize();
    if (disposed) return;
    reviewUrl.value = (await api.reviewPage()).url;
    if (disposed) return;
    ready.value = true;
    await nextTick();
    if (disposed) return;
    await setBounds();
    if (disposed) return;
    reviewOverlay.observe();
    if (host.value) {
      observer = new ResizeObserver(setBounds);
      observer.observe(host.value);
    }
    window.addEventListener("resize", setBounds);
  } catch (reason) {
    uiMessage.error(
      reason instanceof Error ? reason.message : t("reviewNotReady")
    );
  }
});

onBeforeUnmount(() => {
  disposed = true;
  if (focused.value) layout.leftCollapsed = previousLeftCollapsed;
  reviewOverlay.stop();
  stopWindowState?.();
  if (fullscreen.value)
    void window.deepwrite?.windowFrame
      ?.command("toggleFullscreen")
      .catch(() => uiMessage.error("无法退出阅读全屏，请按 F11。"));
  observer?.disconnect();
  window.removeEventListener("resize", setBounds);
  void window.deepwrite?.otter?.setReviewBounds(null);
});
</script>

<template>
  <section
    class="otter-review-panel"
    data-testid="otter-review-panel"
    :data-fullscreen="fullscreen"
    :aria-label="t('reviewCenter')"
  >
    <div v-if="!fullscreen" class="otter-review-heading">
      <button
        v-if="layout.leftCollapsed && !focused"
        class="header-text-button"
        @click="layout.leftCollapsed = false"
      >
        {{ t("expandDirectory") }}
      </button>
      <span>{{ t("manuscriptCompare") }}</span>
      <div>
        <button class="header-text-button" type="button" @click="toggleFocus">
          {{ focused ? t("exitFocus") : t("focusReading") }}
        </button>
        <button
          class="header-text-button"
          type="button"
          @click="toggleFullscreen"
        >
          {{ fullscreen ? t("exitFullscreen") : t("fullscreen") }} · F11
        </button>
      </div>
    </div>
    <div
      ref="host"
      class="otter-review-host"
      data-testid="otter-review-host"
      :aria-busy="!ready"
    >
      <div v-if="!ready" class="otter-review-placeholder">
        {{ t("loading") }}
      </div>
      <img
        v-if="overlayPreview"
        class="otter-review-overlay-preview"
        :src="overlayPreview"
        alt=""
        aria-hidden="true"
      />
      <div v-else-if="overlayPaused" class="otter-review-overlay-status">
        {{ t("continueAfterMenuClose") }}
      </div>
      <span class="sr-only">{{ reviewUrl }}</span>
    </div>
  </section>
</template>

<style scoped>
/* Fullscreen changes presentation, keeping the sidebar preference intact. */
:global(
  .window-frame.is-fullscreen
    .desktop-shell:has(.otter-review-panel[data-fullscreen="true"])
) {
  grid-template-columns: 0 minmax(0, 1fr) 0;
}
:global(
  .window-frame.is-fullscreen
    .desktop-shell:has(.otter-review-panel[data-fullscreen="true"])
    :is(.left-sidebar, .pane-resizer-left)
) {
  display: none;
}
.otter-review-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 0;
}
.otter-review-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 0 0 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}
.otter-review-heading p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.otter-review-host {
  position: relative;
  flex: 1;
  min-height: 260px;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: var(--surface-main);
}
.otter-review-placeholder {
  display: grid;
  height: 100%;
  min-height: 260px;
  place-items: center;
  color: var(--text-secondary);
}
.otter-review-overlay-preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}
.otter-review-overlay-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  pointer-events: none;
}
.otter-error {
  margin: 0;
  color: var(--text-danger, #b42318);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
</style>
