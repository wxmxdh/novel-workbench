<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { ref } from "vue";
import type { OtterContextRef } from "@deepwrite/contracts";
import { useAgentConversation } from "../../composables/useAgentConversation";
import { createScopedTranslator } from "../../i18n";

const props = defineProps<{
  projectId: string;
  context: (OtterContextRef & { contextId: string }) | null;
  active?: boolean;
}>();
const emit = defineEmits<{
  stageCandidate: [content: string, originRunId?: string];
  reviewDiscussion: [material: string];
  openModels: [];
  openManualReview: [];
}>();
const t = createScopedTranslator("components.otterWorkbench");
const conversation = useAgentConversation({ api: () => window.deepwrite });
const draft = computed({
  get: () => conversation.draft.value,
  set: (value: string) => (conversation.draft.value = value)
});
const messages = computed(() => conversation.messages.value);
const modelSettingsLoading = ref(true);
const hasConfiguredModel = ref(false);
let modelSettingsRequest = 0;
const selectedReviewMessages = ref<string[]>([]);
const reviewMaterial = computed(() =>
  messages.value
    .filter(
      (message) =>
        selectedReviewMessages.value.includes(message.id) &&
        message.content.trim()
    )
    .map(
      (message) =>
        `${message.role === "user" ? "作者" : "模型"}：\n${message.content.trim()}`
    )
    .join("\n\n")
);
const reviewMaterialTooLong = computed(
  () => reviewMaterial.value.length > 12_000
);
const contextKey = computed(() =>
  props.context
    ? `${props.projectId}|${props.context.contextPath}|${props.context.contextId}`
    : ""
);

watch(
  contextKey,
  async (key) => {
    if (conversation.isBusy.value) await conversation.stopGeneration();
    conversation.messages.value = [];
    conversation.draft.value = "";
    selectedReviewMessages.value = [];
    if (key && props.context) {
      conversation.sessionId.value = `otter:${props.projectId}:${props.context.contextId}:${crypto.randomUUID()}`;
    }
  },
  { immediate: true }
);
watch(
  () => props.active,
  (active) => {
    if (active) void refreshModelAvailability();
  }
);

async function send(): Promise<void> {
  const api = window.deepwrite?.extrasAgents;
  if (
    !api ||
    !props.context ||
    modelSettingsLoading.value ||
    !hasConfiguredModel.value ||
    !draft.value.trim()
  )
    return;
  await conversation.sendAssistantMessage({
    agentId: "chat-normal",
    profileId: "default",
    input: {
      otter: {
        projectId: props.projectId,
        contextPath: props.context.contextPath,
        ...(props.context.receiptPath
          ? { receiptPath: props.context.receiptPath }
          : {})
      }
    }
  });
}

async function refreshModelAvailability(): Promise<void> {
  const request = ++modelSettingsRequest;
  const listModels = window.deepwrite?.models?.list;
  if (!listModels) {
    if (request !== modelSettingsRequest) return;
    hasConfiguredModel.value = false;
    modelSettingsLoading.value = false;
    return;
  }
  modelSettingsLoading.value = true;
  try {
    const settings = await listModels();
    if (request !== modelSettingsRequest) return;
    conversation.applyModelSettings(settings);
    hasConfiguredModel.value = settings.models.length > 0;
  } catch {
    if (request !== modelSettingsRequest) return;
    hasConfiguredModel.value = false;
  } finally {
    if (request === modelSettingsRequest) modelSettingsLoading.value = false;
  }
}

function handleWindowFocus(): void {
  void refreshModelAvailability();
}

onMounted(() => {
  void refreshModelAvailability();
  window.addEventListener("focus", handleWindowFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", handleWindowFocus);
  if (conversation.isBusy.value) void conversation.stopGeneration();
});
</script>

<template>
  <section class="otter-chat-panel">
    <div class="otter-chat-heading">
      <div>
        <h2>{{ t("sendToAgent") }}</h2>
        <small>{{ t("discussionBoundary") }}</small>
      </div>
      <span v-if="context" class="context-chip">{{ context.contextId }}</span>
    </div>
    <div class="otter-chat-messages" aria-live="polite">
      <article
        v-for="message in messages"
        :key="message.id"
        class="otter-chat-message"
        :class="`is-${message.role}`"
      >
        <label
          v-if="message.status === 'completed'"
          class="otter-team-message-select"
        >
          <input
            v-model="selectedReviewMessages"
            type="checkbox"
            :value="message.id"
          />
          <span>{{ t("selectForTeamReview") }}</span>
        </label>
        <p>{{ message.content }}</p>
        <button
          v-if="
            message.role === 'assistant' &&
            message.status === 'completed' &&
            message.content.trim()
          "
          class="text-button"
          type="button"
          @click="emit('stageCandidate', message.content, message.runId)"
        >
          {{ t("useAsCandidate") }}
        </button>
      </article>
      <p v-if="!context" class="otter-empty">{{ t("noChatContext") }}</p>
      <aside
        v-if="context && !modelSettingsLoading && !hasConfiguredModel"
        class="otter-no-api-model"
      >
        <p>{{ t("noConfiguredApiModel") }}</p>
        <div>
          <button
            class="secondary-button"
            type="button"
            @click="emit('openModels')"
          >
            {{ t("openModelSettings") }}
          </button>
          <button
            class="text-button"
            type="button"
            @click="emit('openManualReview')"
          >
            {{ t("prepareCodexHandoff") }}
          </button>
        </div>
      </aside>
    </div>
    <div v-if="messages.length" class="otter-chat-team-handoff">
      <span>{{
        selectedReviewMessages.length
          ? t("selectedTeamMessages", {
              count: selectedReviewMessages.length,
              chars: reviewMaterial.length
            })
          : t("selectMessagesForTeam")
      }}</span>
      <p v-if="reviewMaterialTooLong" role="alert">
        {{ t("teamMaterialTooLong") }}
      </p>
      <button
        class="secondary-button"
        type="button"
        :disabled="!reviewMaterial || reviewMaterialTooLong"
        @click="emit('reviewDiscussion', reviewMaterial)"
      >
        {{ t("reviewThisTurnWithTeam") }}
      </button>
    </div>
    <form class="otter-chat-composer" @submit.prevent="send">
      <textarea
        v-model="draft"
        :placeholder="t('chatPlaceholder')"
        :disabled="!context || modelSettingsLoading || !hasConfiguredModel"
      />
      <div class="otter-chat-actions">
        <button
          v-if="conversation.canStop.value"
          class="secondary-button"
          type="button"
          @click="conversation.stopGeneration"
        >
          {{ t("stop") }}
        </button>
        <button
          class="primary-button"
          type="submit"
          :disabled="
            !conversation.canSend.value ||
            !context ||
            modelSettingsLoading ||
            !hasConfiguredModel
          "
        >
          {{ t("send") }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.otter-chat-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  gap: 10px;
}
.otter-chat-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.otter-chat-heading h2 {
  margin: 0;
  font-size: 15px;
}
.otter-chat-heading small,
.otter-empty {
  color: var(--text-secondary);
}
.otter-no-api-model {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-left: 3px solid #b85b44;
  border-radius: 9px;
  background: rgba(184, 91, 68, 0.055);
}
.otter-no-api-model p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.otter-no-api-model > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.context-chip {
  max-width: 45%;
  overflow: hidden;
  color: var(--text-secondary);
  font: 11px/1.4 var(--font-mono, Consolas, monospace);
  text-overflow: ellipsis;
}
.otter-chat-messages {
  display: flex;
  flex: 1;
  min-height: 130px;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding: 4px;
}
.otter-chat-message {
  max-width: 94%;
  align-self: flex-start;
  padding: 9px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  background: var(--surface-main);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.otter-chat-message.is-user {
  align-self: flex-end;
  background: var(--surface-selected);
}
.otter-chat-message p {
  margin: 0;
}
.otter-chat-message button {
  margin-top: 7px;
}
.otter-team-message-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
  color: var(--text-secondary);
  font-size: 11px;
}
.otter-chat-team-handoff {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--theme-line);
  color: var(--text-secondary);
  font-size: 11px;
}
.otter-chat-team-handoff p {
  flex-basis: 100%;
  margin: 0;
  color: #9b4d3b;
}
.otter-chat-composer {
  display: grid;
  gap: 8px;
}
.otter-chat-composer textarea {
  width: 100%;
  min-height: 82px;
  resize: vertical;
}
.otter-chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
