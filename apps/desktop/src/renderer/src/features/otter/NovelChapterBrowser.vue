<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { OtterProjectView } from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import {
  normalizedPosition,
  displayModel,
  isHistoricalPath
} from "./novelWorkspaceTree";

type NovelDocument = OtterProjectView["documents"][number];
type ManuscriptKind = "plan" | "draft";

const props = defineProps<{
  chapterPosition: string;
  documents: NovelDocument[];
  selectedPath?: string;
  navigationMode: "compact" | "complete";
}>();
const emit = defineEmits<{
  selectDocument: [path: string];
  selectReference: [path: string];
  markImportant: [path: string];
  returnToDiscussion: [];
  setNavigationMode: [mode: "compact" | "complete"];
}>();
const t = createScopedTranslator("components.otterWorkbench");
const kind = ref<ManuscriptKind>("plan");
const chapterDocuments = computed(() =>
  props.documents.filter(
    (document) =>
      (document.category === "plan" || document.category === "draft") &&
      normalizedPosition(document) === props.chapterPosition
  )
);
const availableKinds = computed(() =>
  (["plan", "draft"] as const).filter((candidate) =>
    chapterDocuments.value.some(({ category }) => category === candidate)
  )
);
watch(
  availableKinds,
  (available) => {
    if (!available.includes(kind.value)) kind.value = available[0] ?? "plan";
  },
  { immediate: true }
);
const currentDocuments = computed(() =>
  chapterDocuments.value.filter(({ category }) => category === kind.value)
);
const currentFiles = computed(() =>
  currentDocuments.value.filter(
    (document) =>
      !isHistorical(document) &&
      document.writingRole !== "candidate" &&
      document.writingRole !== "work"
  )
);
const workFiles = computed(() =>
  currentDocuments.value.filter((document) => document.writingRole === "work")
);
const candidateFiles = computed(() =>
  currentDocuments.value.filter(
    (document) => document.writingRole === "candidate"
  )
);
const referenceFiles = computed(() =>
  candidateFiles.value.filter((document) => document.selectedReference)
);
const candidateGroups = computed(() => {
  const groups = new Map<string, typeof candidateFiles.value>();
  for (const document of candidateFiles.value.filter(
    (item) => !item.selectedReference
  )) {
    const model = displayModel(document.model) ?? t("modelUnknown");
    const group = groups.get(model) ?? [];
    group.push(document);
    groups.set(model, group);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([model, documents]) => {
      const lineages = new Map<string, typeof documents>();
      const roots = documents.filter((document) => !document.revisionOf);
      for (const document of documents.filter((item) => item.revisionOf)) {
        const parent = document.revisionOf!;
        const revisions = lineages.get(parent) ?? [];
        revisions.push(document);
        lineages.set(parent, revisions);
      }
      return { model, documents: roots, lineages: [...lineages] };
    });
});
const historicalFiles = computed(() =>
  currentDocuments.value.filter(isHistorical)
);
const labels = computed(() => {
  const counts = new Map<string, number>();
  for (const document of currentDocuments.value) {
    const label = documentLabel(document);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return new Map(
    currentDocuments.value.map((document) => {
      const label = documentLabel(document);
      return [
        document.path,
        counts.get(label)! > 1 ? `${label} · ${document.path}` : label
      ] as const;
    })
  );
});

function isHistorical(document: NovelDocument): boolean {
  return isHistoricalPath(document.path);
}
function documentLabel(document: NovelDocument): string {
  const model = displayModel(document.model) ?? "模型未标注";
  const version = document.revision?.trim() || document.version?.trim();
  const sources =
    document.sourceCount && document.sourceCount > 1
      ? t("writingSourceCount", { count: document.sourceCount })
      : undefined;
  return [model, version, document.title, sources].filter(Boolean).join(" · ");
}
</script>

<template>
  <main class="novel-chapter-browser" data-testid="novel-chapter-browser">
    <header class="novel-chapter-browser-header">
      <div>
        <small>{{ t("chapterBrowserEyebrow") }}</small>
        <h1>{{ chapterPosition }}</h1>
        <p>{{ t("chapterBrowserReadOnlyHint") }}</p>
      </div>
      <button
        class="header-text-button"
        type="button"
        @click="emit('returnToDiscussion')"
      >
        {{ t("returnToDiscussion") }}
      </button>
      <button
        class="header-text-button"
        type="button"
        @click="
          emit(
            'setNavigationMode',
            navigationMode === 'compact' ? 'complete' : 'compact'
          )
        "
      >
        {{
          navigationMode === "compact"
            ? t("showCompleteFileTree")
            : t("showCompactChapterTree")
        }}
      </button>
    </header>

    <nav
      class="novel-chapter-kind-tabs"
      :aria-label="t('chapterBrowserManuscriptKind')"
    >
      <button
        v-for="item in availableKinds"
        :key="item"
        type="button"
        :aria-current="kind === item ? 'page' : undefined"
        :class="{ active: kind === item }"
        @click="kind = item"
      >
        {{ item === "plan" ? t("writingOutline") : t("writingDraft") }}
        <span>{{
          chapterDocuments.filter((doc) => doc.category === item).length
        }}</span>
      </button>
    </nav>

    <section v-if="availableKinds.length" class="novel-chapter-file-list">
      <p
        v-if="
          !currentFiles.length && !workFiles.length && !candidateFiles.length
        "
        class="novel-chapter-empty"
      >
        {{ t("chapterBrowserNoCurrentFiles") }}
      </p>
      <button
        v-for="document in currentFiles"
        :key="document.path"
        class="novel-chapter-file-row"
        type="button"
        :class="{ active: selectedPath === document.path }"
        :aria-current="selectedPath === document.path ? 'true' : undefined"
        @click="emit('selectDocument', document.path)"
      >
        <span class="novel-chapter-file-copy">
          <strong>{{ labels.get(document.path) }}</strong>
          <small>{{ document.status }}</small>
        </span>
        <span
          v-if="selectedPath === document.path"
          class="novel-chapter-selected"
        >
          {{ t("chapterBrowserPreviewing") }}
        </span>
      </button>

      <section v-if="workFiles.length" class="novel-chapter-subgroup">
        <h2>{{ t("workDrafts") }}</h2>
        <button
          v-for="document in workFiles"
          :key="document.path"
          class="novel-chapter-file-row"
          type="button"
          :class="{ active: selectedPath === document.path }"
          @click="emit('selectDocument', document.path)"
        >
          <span class="novel-chapter-file-copy">
            <strong>{{ labels.get(document.path) }}</strong>
            <small>{{ document.path }}</small>
          </span>
          <span
            v-if="selectedPath === document.path"
            class="novel-chapter-selected"
          >
            {{ t("chapterBrowserPreviewing") }}
          </span>
        </button>
      </section>

      <section v-if="candidateFiles.length" class="novel-chapter-subgroup">
        <h2>{{ t("candidateGroups") }}</h2>
        <div v-if="referenceFiles.length" class="novel-reference-candidate">
          <strong>{{ t("currentReferenceCandidate") }}</strong>
          <div v-for="document in referenceFiles" :key="document.path">
            <button
              class="novel-chapter-file-row"
              type="button"
              :class="{ active: selectedPath === document.path }"
              @click="emit('selectDocument', document.path)"
            >
              <span class="novel-chapter-file-copy">
                <strong>{{ labels.get(document.path) }}</strong>
                <small
                  >{{ document.path }} ·
                  {{ t("referenceIsNotAccepted") }}</small
                >
                <small v-if="document.importantCheckpoint">{{
                  t("importantCheckpoint")
                }}</small>
              </span>
            </button>
            <details
              v-if="document.writingSources?.length"
              class="novel-candidate-sources"
            >
              <summary>
                {{
                  t("writingSourcesDetails", {
                    count: document.writingSources.length
                  })
                }}
              </summary>
              <ul>
                <li
                  v-for="(source, index) in document.writingSources"
                  :key="index"
                >
                  <strong>{{ source.model }}</strong> · {{ source.version }} ·
                  {{ source.title }}
                  <small v-if="source.revisionOf"
                    >{{ t("sourceRevisionOf") }}：{{ source.revisionOf }}</small
                  >
                  <small v-if="source.outline"
                    >{{ t("sourceOutline") }}：{{ source.outline }}</small
                  >
                </li>
              </ul>
            </details>
          </div>
        </div>
        <details
          v-for="{ model, documents, lineages } in candidateGroups"
          :key="model"
          class="novel-candidate-model-group"
        >
          <summary>
            {{ model }}（{{
              documents.length +
              lineages.reduce(
                (count, [, revisions]) => count + revisions.length,
                0
              )
            }}）
          </summary>
          <div
            v-for="document in documents.filter(
              (item) => !item.selectedReference
            )"
            :key="document.path"
            class="novel-candidate-row"
          >
            <button
              class="novel-candidate-open"
              type="button"
              :class="{ active: selectedPath === document.path }"
              @click="emit('selectDocument', document.path)"
            >
              <span class="novel-chapter-file-copy">
                <strong>{{ labels.get(document.path) }}</strong>
                <small>
                  {{ document.path }}
                  <template
                    v-if="document.sourceCount && document.sourceCount > 1"
                  >
                    ·
                    {{
                      t("writingSourceCount", { count: document.sourceCount })
                    }}
                  </template>
                </small>
              </span>
            </button>
            <button
              type="button"
              :disabled="document.selectedReference"
              @click="emit('selectReference', document.path)"
            >
              {{ t("markAsCurrentReference") }}
            </button>
            <button
              v-if="!document.importantCheckpoint"
              type="button"
              @click="emit('markImportant', document.path)"
            >
              {{ t("markImportantCheckpoint") }}
            </button>
            <span v-else>{{ t("importantCheckpoint") }}</span>
            <details
              v-if="document.writingSources?.length"
              class="novel-candidate-sources"
            >
              <summary>
                {{
                  t("writingSourcesDetails", {
                    count: document.writingSources.length
                  })
                }}
              </summary>
              <ul>
                <li
                  v-for="(source, index) in document.writingSources"
                  :key="index"
                >
                  <strong>{{ source.model }}</strong> · {{ source.version }} ·
                  {{ source.title }}
                  <small v-if="source.revisionOf">
                    {{ t("sourceRevisionOf") }}：{{ source.revisionOf }}
                  </small>
                  <small v-if="source.outline">
                    {{ t("sourceOutline") }}：{{ source.outline }}
                  </small>
                </li>
              </ul>
            </details>
          </div>
          <details
            v-for="[parent, revisions] in lineages"
            :key="parent"
            class="novel-candidate-lineage"
          >
            <summary>
              {{ t("revisionLineage", { count: revisions.length }) }} ·
              {{ parent }}
            </summary>
            <div
              v-for="document in revisions"
              :key="document.path"
              class="novel-candidate-row"
            >
              <button
                class="novel-candidate-open"
                type="button"
                :class="{ active: selectedPath === document.path }"
                @click="emit('selectDocument', document.path)"
              >
                <span class="novel-chapter-file-copy">
                  <strong>{{ labels.get(document.path) }}</strong>
                  <small>{{ document.path }}</small>
                </span>
              </button>
              <button
                v-if="!document.importantCheckpoint"
                type="button"
                @click="emit('markImportant', document.path)"
              >
                {{ t("markImportantCheckpoint") }}
              </button>
              <span v-else>{{ t("importantCheckpoint") }}</span>
              <details
                v-if="document.writingSources?.length"
                class="novel-candidate-sources"
              >
                <summary>
                  {{
                    t("writingSourcesDetails", {
                      count: document.writingSources.length
                    })
                  }}
                </summary>
                <ul>
                  <li
                    v-for="(source, index) in document.writingSources"
                    :key="index"
                  >
                    <strong>{{ source.model }}</strong> · {{ source.version }} ·
                    {{ source.title }}
                    <small v-if="source.revisionOf"
                      >{{ t("sourceRevisionOf") }}：{{
                        source.revisionOf
                      }}</small
                    >
                    <small v-if="source.outline"
                      >{{ t("sourceOutline") }}：{{ source.outline }}</small
                    >
                  </li>
                </ul>
              </details>
            </div>
          </details>
        </details>
      </section>

      <details v-if="historicalFiles.length" class="novel-chapter-history">
        <summary>
          {{ t("chapterBrowserHistory", { count: historicalFiles.length }) }}
        </summary>
        <button
          v-for="document in historicalFiles"
          :key="document.path"
          class="novel-chapter-file-row"
          type="button"
          :class="{ active: selectedPath === document.path }"
          :aria-current="selectedPath === document.path ? 'true' : undefined"
          @click="emit('selectDocument', document.path)"
        >
          <span class="novel-chapter-file-copy">
            <strong>{{ labels.get(document.path) }}</strong>
            <small>{{ document.status }}</small>
          </span>
        </button>
      </details>
    </section>
    <p v-else class="novel-chapter-empty">
      {{ t("chapterBrowserNoDocuments") }}
    </p>
  </main>
</template>

<style scoped>
.novel-chapter-browser {
  grid-column: 2 / 4;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
  padding: 22px;
  background: var(--surface-main);
  color: var(--text-primary);
}
.novel-chapter-browser-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.novel-chapter-browser-header small,
.novel-chapter-browser-header p,
.novel-chapter-empty {
  color: var(--text-secondary);
}
.novel-chapter-browser-header h1 {
  margin: 5px 0;
  font-size: 22px;
}
.novel-chapter-browser-header p {
  margin: 0;
}
.novel-chapter-kind-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--theme-line);
}
.novel-chapter-kind-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.novel-chapter-kind-tabs button.active {
  border-bottom-color: var(--accent);
  color: var(--text-primary);
}
.novel-chapter-file-list {
  display: grid;
  align-content: start;
  gap: 8px;
  max-width: 900px;
}
.novel-chapter-file-row {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 15px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.novel-chapter-file-row:hover,
.novel-chapter-file-row.active {
  border-color: var(--accent);
  background: var(--surface-selected);
}
.novel-chapter-file-copy {
  display: grid;
  min-width: 0;
  gap: 5px;
}
.novel-chapter-file-copy strong {
  overflow-wrap: anywhere;
}
.novel-chapter-file-copy small,
.novel-chapter-selected {
  color: var(--text-secondary);
}
.novel-chapter-history {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  color: var(--text-secondary);
}
.novel-chapter-history summary {
  width: fit-content;
  padding: 7px 0;
  cursor: pointer;
}
.novel-chapter-subgroup {
  display: grid;
  gap: 8px;
  max-width: 900px;
}
.novel-chapter-subgroup h2 {
  margin: 8px 0 0;
  font-size: 15px;
}
.novel-candidate-model-group {
  display: grid;
  gap: 8px;
  color: var(--text-secondary);
}
.novel-candidate-model-group summary {
  width: fit-content;
  padding: 8px 0;
  cursor: pointer;
}
.novel-reference-candidate {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--accent);
  border-radius: 10px;
}
.novel-candidate-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.novel-candidate-open {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  padding: 13px 15px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.novel-candidate-open:hover,
.novel-candidate-open.active {
  border-color: var(--accent);
  background: var(--surface-selected);
}
</style>
