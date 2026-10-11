<script setup lang="ts">
import { computed } from "vue";
import { createScopedTranslator } from "../i18n";
import PopupSelect, { type PopupSelectValue } from "./PopupSelect.vue";
import AppIcon from "./AppIcon.vue";

defineProps<{ disabled: boolean }>();
const emit = defineEmits<{
  choose: [
    action: "attachment" | "file" | "copy-folder" | "connect-folder" | "sources"
  ];
}>();
const t = createScopedTranslator("components.longBookSources");
const options = computed(() => [
  { value: "attachment", label: t("turnAttachment") },
  { value: "file", label: t("file") },
  { value: "copy-folder", label: t("importFolder") },
  { value: "connect-folder", label: t("connectMode") },
  { value: "sources", label: t("title") }
]);
function choose(value: PopupSelectValue) {
  if (options.value.some((option) => option.value === value))
    emit(
      "choose",
      value as
        "attachment" | "file" | "copy-folder" | "connect-folder" | "sources"
    );
}
</script>

<template>
  <PopupSelect
    class="source-attachment-menu"
    model-value=""
    :options="options"
    :accessible-label="t('addSources')"
    :disabled="disabled"
    placeholder="+"
    variant="compact"
    :menu-min-width="220"
    @change="choose"
  >
    <template #prefix><AppIcon name="plus" :size="18" /></template>
  </PopupSelect>
</template>

<style scoped>
.source-attachment-menu :deep(.popup-select-trigger) {
  width: 32px;
  height: 32px;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
}
.source-attachment-menu :deep(.popup-select-label),
.source-attachment-menu :deep(.popup-select-chevron) {
  display: none;
}
</style>
