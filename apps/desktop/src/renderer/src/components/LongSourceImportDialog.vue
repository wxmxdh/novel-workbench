<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import type {
  LongSourceAuthority,
  LongSourcePurpose,
  LongStageSourceImportResult
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";
import type { LongSourceImportCandidate } from "../features/long-source-import/useLongSourceImport";

const t = createScopedTranslator("components.longSourceImportDialog");
const props = defineProps<{
  candidate: LongSourceImportCandidate | null;
  staged: LongStageSourceImportResult | null;
  saving?: boolean;
  error?: string;
}>();
const emit = defineEmits<{
  close: [];
  stage: [];
  confirm: [];
  edit: [];
  updatePurposeNote: [value: string];
  updateTitle: [value: string];
  updatePurpose: [value: LongSourcePurpose];
  updateAuthority: [value: LongSourceAuthority];
}>();

const purposeOptions = computed<PopupSelectOption[]>(() => [
  { value: "foundation", label: t("purposeFoundation") },
  { value: "character", label: t("purposeCharacter") },
  { value: "outline", label: t("purposeOutline") },
  { value: "discussion", label: t("purposeDiscussion") },
  { value: "reference", label: t("purposeReference") },
  { value: "other", label: t("purposeOther") }
]);
const authorityOptions = computed<PopupSelectOption[]>(() => [
  { value: "candidate", label: t("authorityCandidate") },
  { value: "undecided", label: t("authorityUndecided") },
  { value: "reference", label: t("authorityReference") }
]);
const isExtractedText = computed(() =>
  /\.(pdf|docx)$/i.test(props.candidate?.sourceName ?? "")
);
const content = computed(
  () => props.staged?.content ?? props.candidate?.content ?? ""
);
const sourceName = computed(
  () => props.staged?.sourceName ?? props.candidate?.sourceName ?? ""
);
const purpose = computed(
  () => props.staged?.purpose ?? props.candidate?.purpose ?? "other"
);
const authority = computed(
  () => props.staged?.authority ?? props.candidate?.authority ?? "undecided"
);
const title = computed(
  () => props.staged?.title ?? props.candidate?.title ?? ""
);
const sha256 = computed(() => props.staged?.sourceSha256 ?? "");
const canEdit = computed(
  () => !!props.candidate && !props.staged && !props.saving
);

function close(): void {
  if (!props.saving) emit("close");
}
function onKeydown(event: KeyboardEvent): void {
  if (props.candidate && event.key === "Escape") close();
}
onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="candidate"
      class="dialog-backdrop source-import-backdrop"
      @mousedown.self="close"
    >
      <section
        class="workspace-dialog source-import-dialog"
        data-testid="long-source-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-import-title"
      >
        <header class="source-import-header">
          <div>
            <span class="dialog-eyebrow"
              >{{ t("source") }} · {{ sourceName }}</span
            >
            <h2 id="source-import-title">{{ t("title") }}</h2>
            <p>{{ t("subtitle") }}</p>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="saving"
            @click="close"
          >
            ×
          </button>
        </header>
        <div class="source-import-body">
          <div class="source-import-meta">
            <label>
              <span>{{ t("bookTitle") }}</span>
              <input
                :value="title"
                :disabled="!canEdit"
                maxlength="240"
                @input="
                  emit('updateTitle', ($event.target as HTMLInputElement).value)
                "
              />
            </label>
            <label>
              <span>{{ t("purpose") }}</span>
              <PopupSelect
                :model-value="purpose"
                :options="purposeOptions"
                :accessible-label="t('purpose')"
                :menu-z-index="1250"
                :disabled="!canEdit"
                @update:model-value="
                  emit('updatePurpose', $event as LongSourcePurpose)
                "
              />
            </label>
            <label>
              <span>{{ t("authority") }}</span>
              <PopupSelect
                :model-value="authority"
                :options="authorityOptions"
                :accessible-label="t('authority')"
                :menu-z-index="1250"
                :disabled="!canEdit"
                @update:model-value="
                  emit('updateAuthority', $event as LongSourceAuthority)
                "
              />
            </label>
          </div>
          <label class="source-purpose-note"
            ><span>{{ t("purposeNote") }}</span
            ><textarea
              :value="candidate.purposeNote ?? ''"
              :disabled="!canEdit"
              maxlength="4000"
              rows="2"
              @input="
                emit(
                  'updatePurposeNote',
                  ($event.target as HTMLTextAreaElement).value
                )
              "
            />
          </label>
          <p v-if="candidate.fromDiscussion" class="source-import-notice">
            {{ t("candidateNotice") }}
          </p>
          <p v-else class="source-import-notice">{{ t("sourceNotice") }}</p>
          <p v-if="isExtractedText" class="source-import-notice">
            {{ t("extractedNotice") }}
          </p>
          <section v-if="candidate.summary" class="source-import-advice">
            <h3>{{ t("summary") }}</h3>
            <p>{{ candidate.summary }}</p>
          </section>
          <div
            v-if="
              candidate.conflicts.length || candidate.unresolvedQuestions.length
            "
            class="source-import-advice-grid"
          >
            <section v-if="candidate.conflicts.length">
              <h3>{{ t("conflicts") }}</h3>
              <ul>
                <li v-for="(item, index) in candidate.conflicts" :key="index">
                  {{ item }}
                </li>
              </ul>
            </section>
            <section v-if="candidate.unresolvedQuestions.length">
              <h3>{{ t("unresolved") }}</h3>
              <ul>
                <li
                  v-for="(item, index) in candidate.unresolvedQuestions"
                  :key="index"
                >
                  {{ item }}
                </li>
              </ul>
            </section>
          </div>
          <section class="source-import-original">
            <div class="source-import-original-heading">
              <h3>{{ t("content") }}</h3>
              <span>{{ content.length.toLocaleString() }} chars</span>
            </div>
            <pre>{{ content }}</pre>
          </section>
          <p v-if="staged" class="source-import-hash">
            <span>{{ t("hash") }}</span
            ><code>{{ sha256 }}</code>
          </p>
          <p v-if="error" class="source-import-error" role="alert">
            {{ error }}
          </p>
          <p class="source-import-warning">{{ t("warning") }}</p>
        </div>
        <footer class="source-import-footer">
          <button
            v-if="staged"
            class="dialog-secondary-button"
            type="button"
            :disabled="saving"
            @click="emit('edit')"
          >
            {{ t("returnToEdit") }}
          </button>
          <button
            class="dialog-secondary-button"
            type="button"
            data-testid="long-source-import-cancel"
            :disabled="saving"
            @click="close"
          >
            {{ t("cancel") }}
          </button>
          <button
            v-if="!staged"
            class="dialog-primary-button"
            type="button"
            data-testid="long-source-import-prepare"
            :disabled="saving || !title.trim()"
            @click="emit('stage')"
          >
            {{ saving ? t("preparing") : t("prepare") }}
          </button>
          <button
            v-else
            class="dialog-primary-button"
            type="button"
            data-testid="long-source-import-confirm"
            :disabled="saving"
            @click="emit('confirm')"
          >
            {{ saving ? t("saving") : t("confirm") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.source-import-backdrop {
  z-index: 1200;
}
.source-import-dialog {
  width: min(860px, calc(100vw - 32px));
  max-height: min(88vh, 900px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.source-import-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 26px 16px;
  border-bottom: 1px solid var(--theme-line-soft);
}
.source-import-header h2 {
  margin: 5px 0;
}
.source-import-header p,
.source-import-notice,
.source-import-warning {
  color: var(--text-secondary);
}
.source-import-body {
  padding: 18px 26px;
  overflow: auto;
}
.source-import-meta {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 14px;
}
.source-import-meta label {
  display: grid;
  gap: 7px;
  min-width: 0;
}
.source-import-meta label > span,
.source-import-original-heading span {
  color: var(--text-secondary);
  font-size: 0.9em;
}
.source-import-meta input,
.source-purpose-note textarea {
  min-width: 0;
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
}
.source-purpose-note {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  color: var(--text-secondary);
}
.source-purpose-note textarea {
  resize: vertical;
}
.source-import-meta input:focus,
.source-purpose-note textarea:focus {
  outline: 2px solid var(--accent-soft);
  border-color: var(--accent);
}
.source-import-notice,
.source-import-warning {
  margin: 12px 0;
  font-size: 0.92em;
}
.source-import-advice,
.source-import-advice-grid section,
.source-import-original {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}
.source-import-advice h3,
.source-import-advice-grid h3,
.source-import-original h3 {
  margin: 0 0 8px;
  font-size: 1em;
}
.source-import-advice p,
.source-import-advice-grid ul {
  margin: 0;
  white-space: pre-wrap;
}
.source-import-advice-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.source-import-advice-grid ul {
  padding-left: 20px;
}
.source-import-original-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.source-import-original pre {
  max-height: min(20vh, 240px);
  overflow: auto;
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 8px;
  background: var(--surface-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
.source-import-hash {
  display: grid;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 0.85em;
}
.source-import-hash code {
  overflow-wrap: anywhere;
}
.source-import-error {
  color: var(--status-danger, #b42318);
}
.source-import-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 26px 20px;
  border-top: 1px solid var(--theme-line-soft);
}
@media (max-width: 640px) {
  .source-import-meta,
  .source-import-advice-grid {
    grid-template-columns: 1fr;
  }
}
</style>
