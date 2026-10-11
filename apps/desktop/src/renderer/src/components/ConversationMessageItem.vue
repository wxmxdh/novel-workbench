<script setup lang="ts">
import { createScopedTranslator, locale } from "../i18n";
import { computed, onBeforeUnmount, ref } from "vue";
import { provideConversationDisclosureScope } from "../composables/conversationDisclosureState";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { LongProposalLocateTarget } from "../utils/approvalNavigation";
import { formatFileSize } from "../composables/useConversationAttachments";
import { presentConversationError } from "../utils/conversationErrorPresentation";
import type {
  ChatMessage,
  ConversationMessageRewriteRequest
} from "../types/conversation";
import { uiMessage } from "../ui-feedback";
import {
  acceptedFileProposalsForMessage,
  approvalItemsForMessage,
  hasProcessing,
  visibleResponse
} from "./conversationToolPresentation";
import AgentEditProposalCard from "./AgentEditProposalCard.vue";
import AppIcon from "./AppIcon.vue";
import ConversationProcessingTimeline from "./ConversationProcessingTimeline.vue";
import ConversationUserMessageEditor from "./ConversationUserMessageEditor.vue";
import LongProposalReview from "./LongProposalReview.vue";
import LoveReviewCoverageBanner from "./LoveReviewCoverageBanner.vue";
import StreamedContent from "./StreamedContent.vue";

const t = createScopedTranslator("components.conversationMessageItem");

const props = withDefaults(
  defineProps<{
    message: ChatMessage;
    allowLiveEditReview?: boolean;
    editable?: boolean;
    editing?: boolean;
    submitEditedMessage?:
      | ((request: ConversationMessageRewriteRequest) => Promise<boolean>)
      | undefined;
    longProposalItems?: readonly LongWorkspaceProposalItem[];
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
  }>(),
  {
    allowLiveEditReview: false,
    editable: false,
    editing: false,
    longProposalItems: () => [],
    longWorkspaceIndex: null
  }
);

const emit = defineEmits<{
  reviewEdit: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  locateEditProposal: [payload: { runId: string; proposalId: string }];
  discardEditProposal: [payload: { runId: string; proposalId: string }];
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [target: LongProposalLocateTarget];
  requestEdit: [messageId: string];
  cancelEdit: [messageId: string];
}>();

provideConversationDisclosureScope(() => props.message.id);
const acceptedFileProposalItems = computed(() =>
  acceptedFileProposalsForMessage(props.message, props.longProposalItems)
);
const errorPresentation = computed(() =>
  presentConversationError(props.message.errorMessage)
);
const summarizedProposalEventIds = computed(
  () => new Set(acceptedFileProposalItems.value.map(({ event }) => event.id))
);
const copied = ref(false);
let copiedTimer: number | undefined;

function formatTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function requestEdit(): void {
  if (props.editable && !props.editing) emit("requestEdit", props.message.id);
}

async function copyMessage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.message.content);
    copied.value = true;
    if (copiedTimer !== undefined) globalThis.clearTimeout(copiedTimer);
    copiedTimer = globalThis.setTimeout(() => {
      copied.value = false;
    }, 1_500);
    uiMessage.success(
      props.message.role === "assistant" ? t("replyCopied") : t("messageCopied")
    );
  } catch {
    uiMessage.error(t("copyFailedTryAgainLater"));
  }
}

onBeforeUnmount(() => {
  if (copiedTimer !== undefined) globalThis.clearTimeout(copiedTimer);
});
</script>

<template>
  <article
    :data-conversation-message-id="message.id"
    class="message"
    :class="[
      `is-${message.role}`,
      {
        'is-editing': editing,
        'is-empty-error':
          message.role === 'assistant' &&
          message.status === 'error' &&
          !message.content &&
          !hasProcessing(message) &&
          !message.subagentRuns?.length &&
          !message.editProposals?.length
      }
    ]"
  >
    <div class="message-body">
      <ConversationProcessingTimeline
        v-if="message.role === 'assistant'"
        :message="message"
        :allow-live-edit-review="allowLiveEditReview"
        :long-proposal-items="longProposalItems"
        :long-workspace-index="longWorkspaceIndex"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @discard-edit-proposal="emit('discardEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
      />
      <div class="message-content">
        <ConversationUserMessageEditor
          v-if="message.role === 'user' && editing && submitEditedMessage"
          :message-id="message.id"
          :initial-content="message.content"
          :disabled="!editable"
          :submit-edited-message="submitEditedMessage"
          @cancel="emit('cancelEdit', message.id)"
        />
        <div
          v-else-if="message.role === 'user'"
          class="message-copy user-message-copy"
          @dblclick="requestEdit"
        >
          <div
            v-if="message.attachments?.length"
            class="message-attachment-list"
            :aria-label="t('messageAttachments')"
          >
            <span
              v-for="attachment in message.attachments"
              :key="attachment.id"
              class="message-attachment-chip"
              :title="`${attachment.name} · ${formatFileSize(attachment.size)}`"
            >
              <AppIcon
                :name="attachment.kind === 'image' ? 'image' : 'file'"
                :size="14"
              />
              <span>{{ attachment.name }}</span>
              <small v-if="attachment.truncated">{{ t("truncated") }}</small>
            </span>
          </div>
          {{ message.content }}
        </div>
        <div
          v-else-if="visibleResponse(message)"
          class="message-copy"
          :class="{ 'is-streaming': message.status === 'streaming' }"
          :data-assistant-response-message-id="
            message.status === 'streaming' ? undefined : message.id
          "
        >
          <StreamedContent
            :content="visibleResponse(message)"
            format="markdown"
            :streaming="message.status === 'streaming'"
          />
        </div>
        <div
          v-if="
            message.role === 'assistant' &&
            message.reviewNotice === 'not_started'
          "
          class="message-stopped-copy"
          role="status"
        >
          {{ t("reviewNotStarted") }}
        </div>
        <LoveReviewCoverageBanner
          v-if="message.role === 'assistant' && message.reviewCoverage"
          :coverage="message.reviewCoverage"
        />
        <div v-if="message.status === 'stopped'" class="message-stopped-copy">
          {{ t("generationStopped") }}
        </div>
        <div
          v-if="message.role === 'assistant' && message.status === 'error'"
          class="message-error-copy"
          role="alert"
        >
          <p>
            {{
              errorPresentation.kind === "gemini-tool-schema"
                ? t("geminiToolSchemaRejected")
                : errorPresentation.summary || t("generationFailed")
            }}
          </p>
          <details v-if="errorPresentation.details">
            <summary>{{ t("showErrorDetails") }}</summary>
            <pre>{{ errorPresentation.details }}</pre>
          </details>
        </div>
        <section
          v-if="
            message.role === 'assistant' &&
            message.status !== 'streaming' &&
            approvalItemsForMessage(message, longProposalItems).length
          "
          class="approval-card-stack"
          :aria-label="t('approvalCardsForThisTurn')"
        >
          <template
            v-for="approval in approvalItemsForMessage(
              message,
              longProposalItems
            )"
            :key="approval.id"
          >
            <AgentEditProposalCard
              v-if="approval.type === 'edit-proposal'"
              :proposal="approval.proposal"
              :message-status="message.status"
              :allow-live-edit-review="allowLiveEditReview"
              :discardable="approval.canDiscard"
              @review="emit('reviewEdit', $event)"
              @locate="emit('locateEditProposal', $event)"
              @discard="emit('discardEditProposal', $event)"
            />
            <LongProposalReview
              v-else-if="
                !summarizedProposalEventIds.has(approval.item.event.id)
              "
              embedded
              conversation-card
              :items="[approval.item]"
              :workspace-index="longWorkspaceIndex"
              @approve="emit('approveLongProposal', $event)"
              @reject="emit('rejectLongProposal', $event)"
              @retry-preview="emit('retryLongProposalPreview', $event)"
              @locate="emit('locateLongProposal', $event)"
            />
          </template>
          <LongProposalReview
            v-if="acceptedFileProposalItems.length"
            embedded
            conversation-card
            compact-summary
            :items="acceptedFileProposalItems"
            :workspace-index="longWorkspaceIndex"
            @locate="emit('locateLongProposal', $event)"
          />
        </section>
      </div>

      <div
        v-if="message.content && message.status !== 'streaming' && !editing"
        class="message-actions"
      >
        <span v-if="message.role === 'user'">{{
          formatTime(message.createdAt)
        }}</span>
        <button
          v-if="message.role === 'user' && editable"
          type="button"
          :aria-label="t('editAndResend')"
          @click="requestEdit"
        >
          <AppIcon name="edit" :size="15" />
        </button>
        <button
          type="button"
          :aria-label="
            copied
              ? t('copied')
              : message.role === 'assistant'
                ? t('copyReply')
                : t('copyMessage')
          "
          @click="copyMessage"
        >
          <AppIcon :name="copied ? 'check' : 'copy'" :size="15" />
        </button>
        <span v-if="message.role === 'assistant'">{{
          formatTime(message.createdAt)
        }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.message.is-user.is-editing .message-body {
  width: 100%;
  max-width: 100%;
}

.message.is-user.is-editing .message-content {
  width: 100%;
  padding: 0;
  background: transparent;
}

.message-error-copy {
  padding: 8px 12px;
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.message-error-copy p {
  margin: 0;
}

.message-error-copy details {
  margin-top: 6px;
}

.message-error-copy summary {
  cursor: pointer;
  color: var(--text-tertiary);
}

.message-error-copy pre {
  max-height: 280px;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font: inherit;
}
</style>
