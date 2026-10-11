<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  CodexCollaborationApi,
  CodexEvent,
  CodexModel,
  CodexSession
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import { CodexScopedRequestGate } from "./codexScopedRequestGate";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";

const t = createScopedTranslator("components.codexCollaborationPanel");
const props = defineProps<{
  api: CodexCollaborationApi;
  scopeKey?: string;
  bookLabel?: string;
  sourcePackage?: { id: string; label: string; text: string } | null;
}>();
const emit = defineEmits<{
  "session-created": [session: CodexSession];
  "session-resumed": [session: CodexSession];
  "candidate-completed": [
    candidate: {
      content: string;
      model: string;
      threadId: string;
      scopeKey: string;
    }
  ];
}>();
type Message = { role: "user" | "codex" | "notice"; text: string };
const models = ref<CodexModel[]>([]);
const selectedModel = ref("");
const selectedEffort = ref("");
const session = ref<CodexSession | null>(null);
const draft = ref("");
const resumeThreadId = ref("");
const messages = ref<Message[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const requestGate = new CodexScopedRequestGate();
let currentOutput = "";
let unsubscribe: (() => void) | undefined;
const modelOptions = computed<PopupSelectOption[]>(() =>
  models.value.map((model) => ({
    value: model.model,
    label: `${model.displayName} (${model.model})`
  }))
);
const selectedModelInfo = computed(() =>
  models.value.find((model) => model.model === selectedModel.value)
);
const effortOptions = computed<PopupSelectOption[]>(
  () =>
    selectedModelInfo.value?.supportedReasoningEfforts.map((option) => ({
      value: option.reasoningEffort,
      label: `${option.reasoningEffort} · ${option.description}`
    })) ?? []
);
watch(selectedModel, () => {
  const available = selectedModelInfo.value?.supportedReasoningEfforts ?? [];
  if (
    !available.some((option) => option.reasoningEffort === selectedEffort.value)
  ) {
    selectedEffort.value =
      selectedModelInfo.value?.defaultReasoningEffort ??
      available[0]?.reasoningEffort ??
      "";
  }
});
const baseScope = computed(
  () => props.scopeKey ?? props.bookLabel ?? "unspecified-work"
);
const scope = computed(() => {
  const sourceText = props.sourcePackage?.text ?? "";
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < sourceText.length; index++) {
    const code = sourceText.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ (code + index), 0x85ebca6b);
  }
  return `${baseScope.value}:${props.sourcePackage?.id ?? "no-source"}:${sourceText.length}:${(hashA >>> 0).toString(16)}${(hashB >>> 0).toString(16)}`;
});
const boundScope = ref(scope.value);
watch(scope, (next) => {
  if (next === boundScope.value) return;
  requestGate.invalidate();
  const priorSession = session.value;
  session.value = null;
  messages.value = [];
  currentOutput = "";
  busy.value = false;
  boundScope.value = next;
  if (priorSession)
    void props.api
      .closeSession({ sessionId: priorSession.sessionId })
      .catch(() => undefined);
});

function onEvent(event: CodexEvent): void {
  if (!session.value || event.sessionId !== session.value.sessionId) return;
  if (event.type === "text") {
    currentOutput += event.text;
    const previous = messages.value.at(-1);
    if (previous?.role === "codex") previous.text += event.text;
    else messages.value.push({ role: "codex", text: event.text });
  } else if (event.type === "status") {
    busy.value = event.status === "started";
    if (event.status === "completed" && currentOutput.trim()) {
      emit("candidate-completed", {
        content: currentOutput,
        model: session.value.model,
        threadId: session.value.threadId,
        scopeKey: `${baseScope.value}:${props.sourcePackage?.id ?? "no-source"}`
      });
    } else if (event.status === "interrupted") {
      messages.value.push({ role: "notice", text: t("turnInterrupted") });
    } else if (event.status === "failed") {
      error.value = t("turnFailed");
    }
  } else if (event.type === "approval-blocked") {
    busy.value = false;
    messages.value.push({
      role: "notice",
      text: `${event.message}（${event.method}）`
    });
  } else if (event.type === "error") {
    busy.value = false;
    error.value = event.message;
  }
}

async function loadModels(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    models.value = await props.api.listModels();
    if (!models.value.some((model) => model.model === selectedModel.value)) {
      selectedModel.value =
        models.value.find((model) => model.isDefault)?.model ??
        models.value[0]?.model ??
        "";
    }
    selectedEffort.value =
      selectedModelInfo.value?.defaultReasoningEffort ??
      selectedModelInfo.value?.supportedReasoningEfforts[0]?.reasoningEffort ??
      "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("modelLoadError");
  } finally {
    loading.value = false;
  }
}

async function send(): Promise<void> {
  const text = draft.value.trim();
  if (!text || busy.value || !selectedModel.value) return;
  const targetScope = scope.value;
  const token = requestGate.begin(targetScope);
  if (!token) return;
  busy.value = true;
  error.value = "";
  try {
    if (boundScope.value !== targetScope) {
      session.value = null;
      messages.value = [];
      currentOutput = "";
      boundScope.value = targetScope;
    }
    const firstTurn =
      !session.value ||
      messages.value.filter((message) => message.role === "user").length === 0;
    const workLabel = props.bookLabel ? `当前作品：${props.bookLabel}\n` : "";
    const source =
      firstTurn && props.sourcePackage?.text.trim()
        ? `\n\n作者选择的资料包（${props.sourcePackage.label}）：\n${props.sourcePackage.text}\n\n请只把这段资料当作本次讨论依据。`
        : "";
    const turnText = `${workLabel}${source}${text}`;
    if (turnText.length > 100_000) {
      error.value = t("tooLong");
      busy.value = false;
      return;
    }
    if (!session.value) {
      const created = await props.api.startSession({
        sessionId: crypto.randomUUID(),
        model: selectedModel.value,
        ...(selectedEffort.value
          ? { reasoningEffort: selectedEffort.value }
          : {}),
        scopeKey: targetScope
      });
      if (!requestGate.isCurrent(token, scope.value)) {
        void props.api
          .closeSession({ sessionId: created.sessionId })
          .catch(() => undefined);
        return;
      }
      session.value = created;
      emit("session-created", created);
    }
    if (!requestGate.isCurrent(token, scope.value) || !session.value) return;
    messages.value.push({ role: "user", text });
    draft.value = "";
    currentOutput = "";
    await props.api.startTurn({
      sessionId: session.value.sessionId,
      text: turnText
    });
  } catch (cause) {
    if (requestGate.isCurrent(token, scope.value)) {
      busy.value = false;
      error.value = cause instanceof Error ? cause.message : t("requestError");
    }
  } finally {
    requestGate.finish(token);
  }
}

async function resume(): Promise<void> {
  if (!resumeThreadId.value.trim() || !selectedModel.value || session.value)
    return;
  const targetScope = scope.value;
  const token = requestGate.begin(targetScope);
  if (!token) return;
  busy.value = true;
  error.value = "";
  try {
    const resumed = await props.api.resumeSession({
      sessionId: crypto.randomUUID(),
      threadId: resumeThreadId.value.trim(),
      model: selectedModel.value,
      ...(selectedEffort.value
        ? { reasoningEffort: selectedEffort.value }
        : {}),
      scopeKey: targetScope
    });
    if (!requestGate.isCurrent(token, scope.value)) {
      void props.api
        .closeSession({ sessionId: resumed.sessionId })
        .catch(() => undefined);
      return;
    }
    session.value = resumed;
    currentOutput = "";
    emit("session-resumed", resumed);
    messages.value = [
      { role: "notice", text: `已恢复独立任务：${session.value.threadId}` }
    ];
  } catch (cause) {
    if (requestGate.isCurrent(token, scope.value))
      error.value = cause instanceof Error ? cause.message : t("resumeError");
  } finally {
    if (requestGate.isCurrent(token, scope.value)) busy.value = false;
    requestGate.finish(token);
  }
}

async function interrupt(): Promise<void> {
  if (!session.value) return;
  try {
    await props.api.interrupt({ sessionId: session.value.sessionId });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("requestError");
  }
}

async function newTask(): Promise<void> {
  const token = requestGate.begin(scope.value);
  if (!token) return;
  busy.value = true;
  const priorSession = session.value;
  try {
    if (priorSession)
      await props.api.closeSession({ sessionId: priorSession.sessionId });
    if (requestGate.isCurrent(token, scope.value)) {
      if (session.value === priorSession) session.value = null;
      messages.value = [];
      currentOutput = "";
      boundScope.value = scope.value;
    }
  } catch (cause) {
    if (requestGate.isCurrent(token, scope.value))
      error.value = cause instanceof Error ? cause.message : t("requestError");
  } finally {
    if (requestGate.isCurrent(token, scope.value)) busy.value = false;
    requestGate.finish(token);
  }
}

onMounted(() => {
  unsubscribe = props.api.onEvent(onEvent);
  void loadModels();
});
onBeforeUnmount(() => {
  requestGate.invalidate();
  unsubscribe?.();
  if (session.value)
    void props.api
      .closeSession({ sessionId: session.value.sessionId })
      .catch(() => undefined);
});
</script>

<template>
  <section class="codex-collaboration">
    <header class="panel-header">
      <div>
        <h2>{{ t("title") }}</h2>
        <p>{{ t("description") }}</p>
        <p v-if="bookLabel" class="scope-label">
          {{ t("currentBook", { book: bookLabel }) }}
        </p>
        <p v-if="sourcePackage?.text" class="scope-label">
          {{ t("attachedSource", { source: sourcePackage.label }) }}
        </p>
      </div>
      <button type="button" :disabled="loading" @click="loadModels">
        {{ t("refreshModels") }}
      </button>
    </header>

    <div class="model-row">
      <PopupSelect
        v-model="selectedModel"
        :options="modelOptions"
        :disabled="loading || modelOptions.length === 0 || busy || !!session"
        :accessible-label="t('modelAccessible')"
        :placeholder="t('modelPlaceholder')"
      />
      <PopupSelect
        v-if="effortOptions.length"
        v-model="selectedEffort"
        :options="effortOptions"
        :disabled="!!session || busy"
        :accessible-label="t('effortAccessible')"
      />
      <span v-if="session" class="thread-id">{{
        t("threadLabel", { thread: session.threadId })
      }}</span>
      <button v-if="session" type="button" :disabled="busy" @click="newTask">
        {{ t("newTask") }}
      </button>
    </div>

    <div class="resume-row">
      <input
        v-model="resumeThreadId"
        :aria-label="t('resumePlaceholder')"
        :placeholder="t('resumePlaceholder')"
        :disabled="busy"
      />
      <button
        type="button"
        :disabled="busy || !resumeThreadId.trim()"
        @click="resume"
      >
        {{ t("resumeTask") }}
      </button>
    </div>

    <div class="transcript" aria-live="polite">
      <p v-if="messages.length === 0" class="empty-state">
        {{ t("emptyState") }}
      </p>
      <article
        v-for="(message, index) in messages"
        :key="index"
        :class="`message is-${message.role}`"
      >
        <strong>{{
          t(
            message.role === "user"
              ? "you"
              : message.role === "codex"
                ? "codex"
                : "notice"
          )
        }}</strong>
        <p>{{ message.text }}</p>
      </article>
    </div>

    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <form class="composer" @submit.prevent="send">
      <textarea
        v-model="draft"
        rows="3"
        :placeholder="t('composerPlaceholder')"
        :disabled="busy || loading || !selectedModel"
      />
      <div class="composer-actions">
        <span>{{ t("permissionNote") }}</span>
        <button v-if="busy" type="button" @click="interrupt">
          {{ t("stop") }}
        </button>
        <button
          v-else
          type="submit"
          :disabled="!draft.trim() || loading || !selectedModel"
        >
          {{ t("send") }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.codex-collaboration {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  color: var(--text-primary);
}
.panel-header,
.model-row,
.resume-row,
.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.panel-header h2 {
  margin: 0;
  font-size: 18px;
}
.panel-header p,
.composer-actions span {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.panel-header .scope-label {
  color: var(--text-primary);
}
.model-row :deep(.popup-select) {
  min-width: 240px;
}
.thread-id {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
}
.resume-row input,
.composer textarea {
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--surface-main);
}
.resume-row input {
  flex: 1;
}
.transcript {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 240px;
  max-height: 55vh;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
}
.empty-state {
  margin: auto;
  max-width: 440px;
  color: var(--text-tertiary);
  text-align: center;
}
.message {
  max-width: 90%;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-raised);
}
.message.is-user {
  align-self: flex-end;
  background: var(--surface-selected);
}
.message.is-notice {
  align-self: center;
  color: var(--text-secondary);
  font-size: 12px;
}
.message strong {
  font-size: 12px;
}
.message p {
  margin: 5px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.composer textarea {
  resize: vertical;
}
.error-message {
  margin: 0;
  color: var(--accent);
}
button {
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--surface-selected);
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
@media (max-width: 680px) {
  .panel-header,
  .model-row,
  .resume-row,
  .composer-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
