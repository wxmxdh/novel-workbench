<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { onMounted, ref } from "vue";

const t = createScopedTranslator("components.authorSupportDialog");

const emit = defineEmits<{ close: [] }>();
const closeButton = ref<HTMLButtonElement | null>(null);
const doneButton = ref<HTMLButtonElement | null>(null);

function handleTab(event: KeyboardEvent): void {
  if (event.shiftKey && document.activeElement === closeButton.value) {
    event.preventDefault();
    doneButton.value?.focus();
  } else if (!event.shiftKey && document.activeElement === doneButton.value) {
    event.preventDefault();
    closeButton.value?.focus();
  }
}

onMounted(() => closeButton.value?.focus());
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop"
      @mousedown.self="emit('close')"
      @keydown.esc.stop="emit('close')"
      @keydown.tab="handleTab"
    >
      <section
        class="workspace-dialog author-support-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="author-support-title"
        aria-describedby="author-support-description"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2 id="author-support-title">{{ t("supportTheAuthor") }}</h2>
          </div>
          <button
            ref="closeButton"
            class="dialog-close"
            type="button"
            :aria-label="t('closeSupportDialog')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-content author-support-content">
          <p id="author-support-description" class="dialog-description">
            {{ t("originalAuthorThanks") }}
          </p>
          <a
            class="upstream-link"
            href="https://github.com/swjybky/deepwrite"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t("upstreamRepository") }}
          </a>
          <div class="dialog-actions">
            <button
              ref="doneButton"
              class="dialog-primary-button"
              type="button"
              @click="emit('close')"
            >
              {{ t("close") }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.author-support-dialog {
  width: min(560px, calc(100vw - 60px));
}

.author-support-content {
  min-height: 0;
}

.upstream-link {
  color: var(--text-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
