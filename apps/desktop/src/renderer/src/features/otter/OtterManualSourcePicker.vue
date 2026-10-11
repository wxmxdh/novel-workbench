<script setup lang="ts">
import { computed, ref } from "vue";
import { createScopedTranslator } from "../../i18n";
import { uiMessage } from "../../ui-feedback";
const t = createScopedTranslator("components.otterManualReview");

type SourceOption = { path: string; title: string };
const props = defineProps<{
  sourceOptions: SourceOption[];
  contextSourcePaths: string[];
  selected: string[];
  hasContext?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:selected": [value: string[]];
}>();
const search = ref("");
const textPattern = /\.(?:md|markdown|txt|json|jsonl|ya?ml|csv)$/i;
const textSources = computed(() =>
  props.sourceOptions.filter((source) => textPattern.test(source.path))
);
const inheritedPaths = computed(
  () => new Set(props.contextSourcePaths.map(normalizePath))
);
const inheritedSources = computed(() =>
  textSources.value.filter((source) =>
    inheritedPaths.value.has(normalizePath(source.path))
  )
);
const supplementalSources = computed(() =>
  textSources.value.filter(
    (source) => !inheritedPaths.value.has(normalizePath(source.path))
  )
);
const filteredSources = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return supplementalSources.value.filter(
    (source) =>
      !query ||
      shortName(source).toLocaleLowerCase().includes(query) ||
      source.path.toLocaleLowerCase().includes(query)
  );
});
const groups = computed(() => {
  const grouped = new Map<string, SourceOption[]>();
  for (const source of filteredSources.value) {
    const group = source.path.split(/[\\/]/u).filter(Boolean)[0] ?? "其他";
    grouped.set(group, [...(grouped.get(group) ?? []), source]);
  }
  return [...grouped.entries()].map(([name, sources]) => ({ name, sources }));
});

function normalizePath(path: string): string {
  return path
    .replace(/^workspace:/u, "")
    .replaceAll("\\", "/")
    .toLocaleLowerCase();
}

function shortName(source: SourceOption): string {
  const name =
    source.path.split(/[\\/]/u).filter(Boolean).at(-1) ?? source.title;
  return name.length <= 48 ? name : `${name.slice(0, 22)}…${name.slice(-22)}`;
}

function toggle(path: string, checked: boolean): void {
  if (checked) {
    if (props.selected.includes(path)) return;
    if (props.selected.length >= 30) {
      uiMessage.error("最多补选 30 项资料。");
      return;
    }
    emit("update:selected", [...props.selected, path]);
    return;
  }
  emit(
    "update:selected",
    props.selected.filter((item) => item !== path)
  );
}
</script>

<template>
  <section class="source-picker">
    <div v-if="hasContext" class="inherited-summary">
      <span v-if="contextSourcePaths.length">
        {{ t("contextSourcesIncluded", { count: contextSourcePaths.length }) }}
      </span>
      <span v-else>{{ t("verifiedContextAutoIncluded") }}</span>
      <details v-if="contextSourcePaths.length" class="inherited-list">
        <summary>{{ t("viewSourceNames") }}</summary>
        <span
          v-for="source in inheritedSources"
          :key="source.path"
          class="source-chip"
          :title="source.path"
          >{{ shortName(source) }}</span
        >
      </details>
    </div>
    <details class="supplement-picker" :aria-disabled="disabled">
      <summary>
        {{ hasContext ? t("supplementSources") : t("chooseDiscussionSources") }}
        <span v-if="selected.length">{{
          t("selectedSourceCount", { count: selected.length })
        }}</span>
      </summary>
      <label class="search-label">
        <span>{{ t("searchSourceNames") }}</span>
        <input
          v-model="search"
          type="search"
          :placeholder="t('searchPlaceholder')"
          :disabled="disabled"
        />
      </label>
      <p v-if="!groups.length" class="muted-note">
        {{ t("noMatchingTextSources") }}
      </p>
      <details v-for="group in groups" :key="group.name" class="source-group">
        <summary>{{ group.name }}（{{ group.sources.length }}）</summary>
        <label
          v-for="source in group.sources"
          :key="source.path"
          class="source-option"
          :title="source.path"
        >
          <input
            type="checkbox"
            :checked="selected.includes(source.path)"
            :value="source.path"
            :disabled="disabled"
            @change="
              toggle(source.path, ($event.target as HTMLInputElement).checked)
            "
          />
          <span>{{ shortName(source) }}</span>
        </label>
      </details>
    </details>
  </section>
</template>

<style scoped>
.source-picker {
  display: grid;
  gap: 8px;
}
.inherited-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  color: var(--text-secondary, #756e67);
}
.supplement-picker {
  border: 1px solid var(--theme-line-soft, #ded8d0);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--surface-raised, #fffdfa);
}
.search-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.search-label input {
  width: 100%;
  border: 1px solid var(--theme-line, #ded8d0);
  border-radius: 9px;
  padding: 9px 10px;
  background: var(--surface-main, #fffdfa);
  color: inherit;
}
.source-group,
.inherited-list {
  border-top: 1px solid var(--theme-line-soft, #ded8d0);
  margin-top: 8px;
  padding-top: 8px;
}
.source-option {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 4px 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--surface-muted, #f4f0ea);
}
.source-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-chip {
  display: inline-flex;
  max-width: 220px;
  overflow: hidden;
  margin: 8px 6px 0 0;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--surface-muted, #f4f0ea);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted-note {
  margin: 8px 0 0;
  color: var(--text-secondary, #756e67);
  font-size: 0.9em;
}
</style>
