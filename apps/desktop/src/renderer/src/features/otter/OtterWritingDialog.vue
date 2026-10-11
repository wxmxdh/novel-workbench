<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type {
  OtterProjectView,
  OtterSaveWritingInput
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";
import PopupSelect from "../../components/PopupSelect.vue";

const props = defineProps<{
  project: OtterProjectView;
  initialKind: "outline" | "draft";
  original?: {
    path: string;
    content: string;
    hash?: string;
    writingRole?: "candidate" | "work" | undefined;
  };
  reply?: {
    content: string;
    model: string;
    evidence?: "request-config" | "runtime-report";
  };
}>();
const emit = defineEmits<{
  close: [];
  saved: [
    path: string,
    category: "plan" | "draft",
    status: "author-candidate" | "author-work-draft",
    deduplicated: boolean
  ];
}>();
const t = createScopedTranslator("components.otterWorkbench");
const metadata = props.project.documents.find(
  (item) => item.path === props.original?.path
);
const title = ref(metadata?.title ?? "");
const kind = ref<"outline" | "draft">(props.initialKind);
const volume = ref(metadata?.volume ?? "");
const chapter = ref(Number(metadata?.chapter?.match(/\d+/)?.[0] ?? 1));
const model = ref(props.reply?.model ?? metadata?.model ?? "unknown");
const version = ref("");
const outline = ref(metadata?.outline ?? "");
const content = ref(
  props.reply?.content ??
    props.original?.content.replace(
      /^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/,
      ""
    ) ??
    ""
);
const error = ref("");
const saving = ref(false);
const savingMode = ref<"candidate" | "work">("candidate");
const dialog = ref<HTMLElement>();
const titleInput = ref<HTMLInputElement>();
const priorFocus = document.activeElement as HTMLElement | null;
onMounted(async () => {
  await nextTick();
  titleInput.value?.focus();
});
const outlineOptions = computed(() => [
  { value: "", label: t("writingNoOutline") },
  ...props.project.documents
    .filter((item) => item.category === "plan")
    .map((item) => ({ value: item.path, label: item.title }))
]);
function close() {
  if (!saving.value) {
    emit("close");
    priorFocus?.focus();
  }
}
function trapFocus(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const elements = [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]'
    ) ?? [])
  ];
  const edge = event.shiftKey ? elements[0] : elements.at(-1);
  if (document.activeElement === edge) {
    event.preventDefault();
    (event.shiftKey ? elements.at(-1) : elements[0])?.focus();
  }
}
async function save(mode: "candidate" | "work") {
  if (
    !title.value.trim() ||
    !volume.value.trim() ||
    !Number.isInteger(chapter.value) ||
    chapter.value < 1 ||
    chapter.value > 100000 ||
    !model.value.trim() ||
    !version.value.trim() ||
    !content.value.trim()
  ) {
    error.value = t("writingInvalid");
    return;
  }
  const input: OtterSaveWritingInput = {
    projectId: props.project.project.id,
    title: title.value,
    kind: kind.value,
    volume: volume.value,
    chapter: chapter.value,
    model: model.value,
    version: version.value,
    mode,
    content: content.value,
    ...(mode === "work" &&
    props.original?.writingRole === "work" &&
    props.original.hash
      ? { expectedHash: props.original.hash }
      : {}),
    ...(outline.value ? { outline: outline.value } : {}),
    ...(props.original ? { revisionOf: props.original.path } : {})
  };
  saving.value = true;
  savingMode.value = mode;
  error.value = "";
  try {
    const result = await window.deepwrite!.otter!.saveWriting(input);
    emit(
      "saved",
      result.path,
      kind.value === "outline" ? "plan" : "draft",
      result.status,
      result.deduplicated
    );
    priorFocus?.focus();
  } catch (reason) {
    error.value = formatError(reason, t("apiUnavailable"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop writing-candidate-overlay"
      @mousedown.self="close"
      @keydown="trapFocus"
    >
      <section
        ref="dialog"
        class="writing-candidate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="writing-candidate-title"
        tabindex="-1"
      >
        <header>
          <h2 id="writing-candidate-title">
            {{ original ? t("writingRevision") : t("writingNew") }}
          </h2>
          <button class="header-text-button" :disabled="saving" @click="close">
            {{ t("writingCancel") }}
          </button>
        </header>
        <p>{{ t("writingBoundary") }}</p>
        <p v-if="reply">
          {{ t("replySavedPathAndBoundary") }}
          {{
            reply.evidence === "runtime-report"
              ? t("replyModelRuntimeEvidence")
              : reply.evidence === "request-config"
                ? t("replyModelRequestEvidence")
                : t("replyModelUnknownEvidence")
          }}
          {{ t("replyUnderstandingBoundary") }}
          {{ t("replyFormalDeliveryBoundary") }}
        </p>
        <p v-if="original" class="revision-source">
          {{ t("writingRevisionFrom") }}: {{ original.path }}
        </p>
        <form @submit.prevent="save('candidate')">
          <div class="writing-candidate-fields">
            <label
              >{{ t("writingTitle")
              }}<input
                ref="titleInput"
                v-model="title"
                maxlength="120"
                :disabled="saving"
                required
            /></label>
            <label
              >{{ t("writingKind")
              }}<PopupSelect
                :model-value="kind"
                :options="[
                  { value: 'outline', label: t('writingOutline') },
                  { value: 'draft', label: t('writingDraft') }
                ]"
                :accessible-label="t('writingKind')"
                :disabled="saving"
                @update:model-value="
                  kind = $event === 'outline' ? 'outline' : 'draft'
                "
            /></label>
            <label
              >{{ t("writingVolume")
              }}<input
                v-model="volume"
                maxlength="200"
                :disabled="saving"
                required
            /></label>
            <label
              >{{ t("writingChapter")
              }}<input
                v-model.number="chapter"
                type="number"
                min="1"
                max="100000"
                :disabled="saving"
                required
            /></label>
            <label
              >{{ t("writingModel")
              }}<input
                v-model="model"
                maxlength="200"
                :readonly="Boolean(reply)"
                :disabled="saving"
                required
            /></label>
            <label
              >{{ t("writingVersion")
              }}<input
                v-model="version"
                maxlength="120"
                :disabled="saving"
                required
            /></label>
          </div>
          <label
            >{{ t("writingOutlineRef")
            }}<PopupSelect
              :model-value="outline"
              :options="outlineOptions"
              :accessible-label="t('writingOutlineRef')"
              :disabled="saving"
              @update:model-value="outline = String($event)"
          /></label>
          <label
            >{{ t("writingContent")
            }}<textarea
              v-model="content"
              maxlength="100000"
              :disabled="saving"
              required
            />
          </label>
          <p v-if="error" role="alert">{{ error }}</p>
          <footer>
            <button type="button" :disabled="saving" @click="save('work')">
              {{
                saving && savingMode === "work"
                  ? t("saving")
                  : t("saveWorkDraft")
              }}
            </button>
            <button class="primary-button" type="submit" :disabled="saving">
              {{
                saving && savingMode === "candidate"
                  ? t("saving")
                  : t("deliverCandidate")
              }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.writing-candidate-overlay {
  z-index: 1200;
}
.writing-candidate-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.writing-candidate-dialog {
  width: min(820px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow: 0 18px 60px #0003;
}
header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: calc(var(--ui-font-size, 14px) * 1.43);
}
p {
  color: var(--text-secondary);
  font-size: calc(var(--ui-font-size, 14px) * 0.86);
}
.revision-source {
  overflow-wrap: anywhere;
}
form,
label {
  display: grid;
  gap: 8px;
}
form {
  gap: 16px;
}
.writing-candidate-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
input,
textarea {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 10px;
  color: var(--text-primary);
  background: var(--surface-main);
  border: 1px solid var(--line);
  border-radius: 8px;
  font: inherit;
}
textarea {
  min-height: 240px;
  resize: vertical;
  line-height: 1.7;
}
footer {
  justify-content: flex-end;
}
@media (max-width: 640px) {
  .writing-candidate-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
