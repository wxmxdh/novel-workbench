<script setup lang="ts">
import { computed } from "vue";
import {
  REVIEW_SKILL_CATALOG,
  REVIEW_SKILL_IDS,
  type ReviewSkillId
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
const t = createScopedTranslator("components.reviewSkillSettings");
const props = defineProps<{
  modelValue?: readonly ReviewSkillId[] | undefined;
  disabled?: boolean;
  inherit?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: ReviewSkillId[] | undefined];
}>();
const inherited = computed(
  () => props.inherit && props.modelValue === undefined
);
function toggle(id: ReviewSkillId, event: Event) {
  if (props.disabled) return;
  const checked = (event.target as HTMLInputElement).checked;
  const selected = new Set(props.modelValue ?? []);
  if (checked) selected.add(id);
  else selected.delete(id);
  emit(
    "update:modelValue",
    REVIEW_SKILL_IDS.filter((skill) => selected.has(skill))
  );
}
function setInheritance(event: Event) {
  if (props.disabled) return;
  emit(
    "update:modelValue",
    (event.target as HTMLInputElement).checked
      ? undefined
      : [...REVIEW_SKILL_IDS]
  );
}
</script>

<template>
  <fieldset class="review-skill-selector" :disabled="disabled">
    <legend>{{ t("title") }}</legend>
    <label v-if="inherit" class="inherit-option">
      <input type="checkbox" :checked="inherited" @change="setInheritance" />
      {{ t("inherit") }}
    </label>
    <div v-if="!inherited" class="skill-options">
      <label v-for="skill in REVIEW_SKILL_CATALOG" :key="skill.id">
        <input
          type="checkbox"
          :checked="modelValue?.includes(skill.id) ?? false"
          @change="toggle(skill.id, $event)"
        />
        <span
          ><strong>{{ skill.id }}</strong>
          <small v-if="skill.archived" class="archived-label">{{ t("archived") }}</small
          ><small>{{ t(skill.id) }}</small></span
        >
        <a
          :href="skill.source"
          target="_blank"
          rel="noopener noreferrer"
          @click.stop
          >{{ skill.revision }}</a
        >
      </label>
    </div>
    <p>{{ t(inherit ? "memberHelp" : "globalHelp") }}</p>
  </fieldset>
</template>

<style scoped>
.review-skill-selector {
  margin: 0;
  padding: 16px;
  border: 1px solid var(--theme-line);
  border-radius: 12px;
  min-width: 0;
  color: var(--text-primary);
  background: var(--surface-raised);
}
legend {
  padding: 0 6px;
  font-weight: 600;
}
.skill-options {
  display: grid;
  gap: 12px;
}
label {
  display: flex;
  align-items: start;
  gap: 10px;
  cursor: pointer;
}
.inherit-option {
  margin-bottom: 12px;
}
input {
  margin: 3px 0 0;
  accent-color: var(--accent);
}
span {
  flex: 1;
  min-width: 0;
}
small {
  display: block;
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.6;
}
.archived-label {
  display: inline-block;
  margin: 0 0 0 8px;
  color: var(--text-tertiary);
  font-size: 0.78em;
}
a {
  color: var(--accent);
  font-size: 0.8em;
  overflow-wrap: anywhere;
}
p {
  margin: 12px 0 0;
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.6;
}
input:focus-visible,
a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
