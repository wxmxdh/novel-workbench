<script setup lang="ts">
import { ref, watch } from "vue";
import {
  defaultReviewSkillSettings,
  type ReviewSkillId,
  type ReviewSkillSettings
} from "@deepwrite/contracts/renderer";
import ReviewSkillSelector from "./ReviewSkillSelector.vue";
import { createScopedTranslator } from "../i18n";
import { formatError } from "../i18n/errors";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";
const t = createScopedTranslator("components.reviewSkillSettings");
const props = defineProps<{
  settings?: ReviewSkillSettings | undefined;
  disabled?: boolean;
}>();
const store = useSettingsStore();
const draft = ref<ReviewSkillId[]>([]);
const saving = ref(false);
watch(
  () => props.settings,
  (settings) => {
    draft.value = [
      ...(settings?.enabledIds ?? defaultReviewSkillSettings().enabledIds)
    ];
  },
  { immediate: true, deep: true }
);
async function save() {
  const api = window.deepwrite;
  if (!api || props.disabled || saving.value || store.agentTeamSaving) return;
  saving.value = true;
  store.agentTeamSaving = true;
  try {
    store.markLoaded(
      "agentTeams",
      await api.agentTeams.saveReviewSkills({ enabledIds: [...draft.value] })
    );
    uiMessage.success(t("saved"));
  } catch (error) {
    uiMessage.error(formatError(error, t("failed")));
  } finally {
    saving.value = false;
    store.agentTeamSaving = false;
  }
}
</script>

<template>
  <section class="global-review-skills">
    <ReviewSkillSelector
      :model-value="draft"
      :disabled="disabled || saving"
      @update:model-value="draft = $event ?? []"
    />
    <div class="actions">
      <button type="button" :disabled="disabled || saving" @click="save">
        {{ t(saving ? "saving" : "save") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.global-review-skills {
  margin-bottom: 24px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
button {
  border: 1px solid var(--text-primary);
  border-radius: 9px;
  padding: 8px 14px;
  color: var(--surface-main);
  background: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
