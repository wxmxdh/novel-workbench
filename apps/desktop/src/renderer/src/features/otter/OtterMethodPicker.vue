<script setup lang="ts">
import { computed } from "vue";
import type { OtterDiscussionInput } from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
type Skill = NonNullable<OtterDiscussionInput["skills"]>[number];
const props = defineProps<{
  selected: Skill[];
  sources: string[];
  entries: { path: string; title: string }[];
  disabled: boolean;
}>();
const emit = defineEmits<{
  "update:selected": [skills: Skill[]];
  "update:sources": [paths: string[]];
}>();
const t = createScopedTranslator("components.otterWorkbench");
const methods = computed(() => [
  { id: "otter-novel" as const, label: t("skillsOtter") },
  { id: "line-editing" as const, label: t("skillsLine") },
  { id: "revision-continuity" as const, label: t("skillsContinuity") },
  { id: "scene-craft" as const, label: t("skillsScene") },
  { id: "story-maintenance" as const, label: t("skillsMaintenance") },
  { id: "voice-style" as const, label: t("skillsVoice") }
]);
function choose(id: Skill, checked: boolean) {
  emit("update:selected", [
    ...new Set([
      "otter-novel" as const,
      ...props.selected.filter((item) => item !== id),
      ...(checked ? [id] : [])
    ])
  ]);
}
function chooseEntry(path: string, checked: boolean) {
  if (checked && props.sources.length >= 30) return;
  emit("update:sources", [
    ...props.sources.filter((item) => item !== path),
    ...(checked ? [path] : [])
  ]);
}
</script>
<template>
  <section class="method-picker">
    <details>
      <summary>{{ t("skillsHeading") }}</summary>
      <p>{{ t("skillsBoundary") }}</p>
      <label v-for="method in methods" :key="method.id"
        ><input
          type="checkbox"
          :checked="selected.includes(method.id)"
          :disabled="disabled || method.id === 'otter-novel'"
          @change="
            choose(method.id, ($event.target as HTMLInputElement).checked)
          "
        />{{ method.label }}</label
      >
    </details>
    <details>
      <summary>{{ t("resourcesDeclared") }}</summary>
      <p>{{ t("resourcesBoundary") }}</p>
      <label v-for="entry in entries" :key="entry.path" :title="entry.path"
        ><input
          type="checkbox"
          :checked="sources.includes(entry.path)"
          :disabled="
            disabled || (!sources.includes(entry.path) && sources.length >= 30)
          "
          @change="
            chooseEntry(entry.path, ($event.target as HTMLInputElement).checked)
          "
        />{{ entry.title }}</label
      >
      <p v-if="!entries.length">{{ t("resourcesNoEntries") }}</p>
    </details>
  </section>
</template>
<style scoped>
.method-picker {
  display: grid;
  gap: 8px;
  margin-block-end: 12px;
}
details {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-main);
}
summary {
  cursor: pointer;
}
p {
  font-size: calc(var(--ui-font-size, 14px) * 0.86);
  color: var(--text-secondary);
}
label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-block: 8px;
  overflow-wrap: anywhere;
}
input {
  accent-color: var(--accent);
}
</style>
