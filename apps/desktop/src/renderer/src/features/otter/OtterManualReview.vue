<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  OtterContextRef,
  OtterManualHandoffResult,
  OtterManualReport
} from "@deepwrite/contracts";
import { OtterManualHandoffResultSchema } from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import { getErrorPayload } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import OtterManualDiscussionPreview from "./OtterManualDiscussionPreview.vue";
import OtterManualSourcePicker from "./OtterManualSourcePicker.vue";

type SourceOption = { path: string; title: string };
type DiscussionMessage = {
  role: "author" | "assistant";
  label: string;
  content: string;
};
type ManualApi = {
  manualHandoff(input: {
    projectId: string;
    context?: OtterContextRef;
    sources: string[];
    instructions: string;
  }): Promise<OtterManualHandoffResult>;
  manualReport(input: { handoffId: string }): Promise<OtterManualReport>;
};
const props = withDefaults(
  defineProps<{
    projectId: string;
    contextRef?: OtterContextRef | null;
    contextSourcePaths?: string[];
    discussionSnapshot?: DiscussionMessage[] | null;
    discussionSummary?: string | null;
    sourceOptions: SourceOption[];
    api?: ManualApi;
    active?: boolean;
  }>(),
  { active: true, discussionSnapshot: null, contextSourcePaths: () => [] }
);
const t = createScopedTranslator("components.otterManualReview");

const selected = ref<string[]>([]);
const instructions = ref("");
const handoff = ref<OtterManualHandoffResult | null>(null);
const report = ref<OtterManualReport | null>(null);
const busy = ref(false);
const copied = ref(false);
let pollTimer: ReturnType<typeof setInterval> | undefined;
let mounted = false;

const api = computed(
  () =>
    props.api ?? (window.deepwrite?.otter as unknown as ManualApi | undefined)
);
const textSourcePattern = /\.(?:md|markdown|txt|json|jsonl|ya?ml|csv)$/i;
const hasNonTextSources = computed(() =>
  props.sourceOptions.some((source) => !textSourcePattern.test(source.path))
);
const discussionMessages = computed(() =>
  (props.discussionSnapshot ?? []).filter(
    (message) => message.content.length > 0
  )
);
const serializedDiscussion = computed(() => {
  const summary = props.discussionSummary?.trim();
  if (summary) return `【本次讨论摘要（由当前模型整理）】\n\n${summary}`;
  return `【本次讨论记录（完整原文，按顺序）】\n\n${discussionMessages.value
    .map(
      (message) =>
        `【${message.role === "author" ? "作者" : "模型"} · ${message.label}】\n${message.content}`
    )
    .join("\n\n")}`;
});
const preparedInstructions = computed(() => {
  const sections = [
    instructions.value.trim(),
    discussionMessages.value.length || props.discussionSummary?.trim()
      ? serializedDiscussion.value
      : ""
  ].filter(Boolean);
  return sections.join("\n\n");
});
const instructionsTooLong = computed(
  () => preparedInstructions.value.length > 20_000
);
const canGenerate = computed(
  () =>
    !busy.value &&
    !instructionsTooLong.value &&
    !!props.projectId &&
    (!!props.contextRef || selected.value.length > 0)
);

function errorMessage(reason: unknown, fallback: string): string {
  const payload = getErrorPayload(reason);
  if (payload?.message) return payload.message;
  return reason instanceof Error ? reason.message : fallback;
}

async function generate(): Promise<void> {
  const port = api.value;
  if (!port || !canGenerate.value) return;
  busy.value = true;
  report.value = null;
  const requestedProject = props.projectId;
  try {
    const preparedHandoff = await port.manualHandoff({
      projectId: props.projectId,
      ...(props.contextRef
        ? {
            context: {
              projectId: props.contextRef.projectId,
              contextPath: props.contextRef.contextPath,
              ...(props.contextRef.receiptPath
                ? { receiptPath: props.contextRef.receiptPath }
                : {})
            }
          }
        : {}),
      sources: [...selected.value],
      instructions: preparedInstructions.value
    });
    try {
      localStorage.setItem(
        `otter-manual:${requestedProject}`,
        JSON.stringify(preparedHandoff)
      );
    } catch {
      /* Local navigation persistence is optional. */
    }
    if (props.projectId !== requestedProject) return;
    handoff.value = preparedHandoff;
    await refreshReport();
  } catch (reason) {
    if (props.projectId !== requestedProject) return;
    uiMessage.error(errorMessage(reason, "生成交接资料失败。"));
  } finally {
    busy.value = false;
  }
}

async function refreshReport(): Promise<void> {
  const port = api.value;
  if (!port || !handoff.value) return;
  const requestedId = handoff.value.handoffId;
  try {
    const nextReport = await port.manualReport({ handoffId: requestedId });
    if (handoff.value?.handoffId !== requestedId) return;
    report.value = nextReport;
  } catch (reason) {
    if (handoff.value?.handoffId !== requestedId) return;
    uiMessage.error(errorMessage(reason, "读取复核意见失败。"));
  }
}

async function copyPrompt(): Promise<void> {
  if (!handoff.value) return;
  try {
    await navigator.clipboard.writeText(handoff.value.prompt);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1800);
  } catch {
    uiMessage.error(t("copyFailure"));
  }
}

function pollingAllowed(): boolean {
  return (
    mounted &&
    props.active &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}
function syncPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
  if (pollingAllowed() && handoff.value)
    pollTimer = setInterval(() => void refreshReport(), 5000);
}
function handleFocus(): void {
  if (pollingAllowed()) void refreshReport();
  syncPolling();
}
watch(() => handoff.value?.handoffId, syncPolling);
watch(
  () => props.projectId,
  (projectId) => {
    selected.value = [];
    instructions.value = "";
    report.value = null;
    handoff.value = null;
    try {
      const saved = localStorage.getItem(`otter-manual:${projectId}`);
      if (saved) {
        const parsed = OtterManualHandoffResultSchema.safeParse(
          JSON.parse(saved)
        );
        if (parsed.success) handoff.value = parsed.data;
      }
    } catch {
      /* Invalid saved navigation does not affect project data. */
    }
    if (props.active) void refreshReport();
  },
  { immediate: true }
);
watch(
  () => props.active,
  (active) => {
    if (active) void refreshReport();
    syncPolling();
  }
);
onMounted(() => {
  mounted = true;
  window.addEventListener("focus", handleFocus);
  window.addEventListener("blur", syncPolling);
  document.addEventListener("visibilitychange", handleFocus);
  syncPolling();
});
onBeforeUnmount(() => {
  mounted = false;
  if (pollTimer) clearInterval(pollTimer);
  window.removeEventListener("focus", handleFocus);
  window.removeEventListener("blur", syncPolling);
  document.removeEventListener("visibilitychange", handleFocus);
});
</script>

<template>
  <section class="otter-manual-review" data-testid="otter-manual-review">
    <header>
      <h2>{{ t("title") }}</h2>
      <p>{{ t("subtitle") }}</p>
    </header>

    <OtterManualDiscussionPreview
      :messages="discussionMessages"
      :summary="discussionSummary ?? null"
    />

    <p v-if="contextRef" class="context-note">
      {{ t("verifiedContext", { path: contextRef.contextPath }) }}
      <span>{{ t("contextAutoIncluded") }}</span>
    </p>
    <p v-if="hasNonTextSources" class="context-note">
      {{ t("nonTextSources") }}
    </p>

    <OtterManualSourcePicker
      v-model:selected="selected"
      :source-options="sourceOptions"
      :context-source-paths="contextSourcePaths"
      :has-context="!!contextRef"
      :disabled="busy"
    />

    <label class="request-label">
      <span>{{ t("authorRequest") }}</span>
      <textarea
        v-model="instructions"
        rows="3"
        :placeholder="t('requestPlaceholder')"
      />
    </label>
    <p class="limit-note" :class="{ 'is-error': instructionsTooLong }">
      {{ t("characterCount", { count: preparedInstructions.length }) }}
      <span v-if="instructionsTooLong">
        {{ t("instructionsTooLong") }}
      </span>
    </p>
    <div class="actions">
      <button type="button" :disabled="!canGenerate" @click="generate">
        {{ busy ? t("preparing") : t("generate") }}
      </button>
      <button
        v-if="handoff"
        type="button"
        class="secondary-button"
        @click="copyPrompt"
      >
        {{ copied ? t("copied") : t("copyPrompt") }}
      </button>
      <button
        v-if="handoff"
        type="button"
        class="secondary-button"
        @click="refreshReport"
      >
        {{ t("checkReport") }}
      </button>
    </div>
    <section v-if="handoff" class="handoff-output">
      <p>
        {{ t("directory") }}<code>{{ handoff.directory }}</code>
      </p>
      <p>
        {{ t("saveOnlyAt") }}<code>{{ handoff.reportPath }}</code>
      </p>
      <details>
        <summary>{{ t("showPrompt") }}</summary>
        <pre>{{ handoff.prompt }}</pre>
      </details>
      <section class="report" aria-live="polite">
        <h3>{{ t("report") }}</h3>
        <p v-if="report?.status === 'stale'" class="stale">
          {{ t("stale") }}
        </p>
        <p v-else-if="report?.markdown">{{ t("reportReady") }}</p>
        <p v-else-if="report?.status === 'pending'">
          {{ t("waiting") }}
        </p>
        <p v-else>{{ t("noReport") }}</p>
        <pre v-if="report?.markdown" class="report-markdown">{{
          report.markdown
        }}</pre>
      </section>
    </section>
  </section>
</template>

<style scoped>
.otter-manual-review {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 980px;
  padding: 16px;
  color: var(--text-primary, #302d2a);
}
header h2 {
  margin: 0 0 4px;
}
header p,
.context-note {
  margin: 0;
  color: var(--text-secondary, #756e67);
}
.handoff-output {
  border: 1px solid var(--theme-line-soft, #ded8d0);
  border-radius: 12px;
  padding: 12px;
  background: var(--surface-raised, #fffdfa);
}
.limit-note {
  color: var(--text-secondary, #756e67);
  font-size: 0.9em;
}
.request-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.request-label textarea {
  width: 100%;
  border: 1px solid var(--theme-line, #ded8d0);
  border-radius: 9px;
  padding: 9px 10px;
  background: var(--surface-main, #fffdfa);
  color: inherit;
  resize: vertical;
  min-height: 72px;
}
.limit-note {
  margin: -6px 0 0;
}
.is-error {
  color: var(--accent, #a34534);
}
.limit-note span {
  display: block;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions button {
  border: 0;
  border-radius: 9px;
  padding: 9px 14px;
  background: var(--accent, #c87861);
  color: white;
}
.actions button:disabled {
  opacity: 0.5;
}
.secondary-button {
  background: var(--surface-muted, #eee8df) !important;
  color: inherit !important;
}
code {
  overflow-wrap: anywhere;
}
.handoff-output p {
  overflow-wrap: anywhere;
}
.handoff-output details {
  margin-top: 12px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 400px;
  overflow: auto;
  border-radius: 8px;
  padding: 12px;
  background: var(--surface-muted, #f4f0ea);
}
.report {
  border-top: 1px solid var(--theme-line-soft, #ded8d0);
  margin-top: 14px;
  padding-top: 12px;
}
.report-markdown {
  max-height: 60vh;
}
.stale {
  color: var(--accent, #a34534);
}
</style>
