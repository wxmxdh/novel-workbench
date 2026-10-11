<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { AgentConversationController } from "../composables/useAgentConversation";
import MessageMarkdown from "./MessageMarkdown.vue";

const props = defineProps<{
  controller: AgentConversationController | null;
  bookTitle: string;
}>();
const emit = defineEmits<{ close: [] }>();
const t = createScopedTranslator("components.longWorkspaceModule");

function selectSession(sessionId: string): void {
  if (props.controller?.isBusy.value) return;
  props.controller?.selectConversation(sessionId);
}
</script>

<template>
  <Teleport to="body">
    <div class="legacy-dialog-backdrop" @mousedown.self="emit('close')">
      <section
        class="legacy-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('legacyHistoryTitle', { title: bookTitle })"
      >
        <header class="legacy-dialog-header">
          <div>
            <strong>{{ t("legacyHistoryTitle", { title: bookTitle }) }}</strong>
            <p>{{ t("legacyHistoryDescription") }}</p>
          </div>
          <button class="icon-button" type="button" @click="emit('close')">
            {{ t("legacyHistoryClose") }}
          </button>
        </header>
        <div v-if="controller" class="legacy-dialog-body">
          <nav
            class="legacy-session-list"
            :aria-label="t('legacyHistorySessions')"
          >
            <button
              v-for="item in controller.history.value"
              :key="item.sessionId"
              class="legacy-session"
              :class="{ selected: item.current }"
              type="button"
              :disabled="controller.isBusy.value"
              :aria-current="item.current ? 'true' : undefined"
              @click="selectSession(item.sessionId)"
            >
              <strong>{{ item.title }}</strong>
              <span>{{ item.preview || t("legacyHistoryEmptyPreview") }}</span>
            </button>
            <p v-if="!controller.history.value.length" class="legacy-empty">
              {{ t("legacyHistoryEmpty") }}
            </p>
          </nav>
          <div class="legacy-message-list">
            <article
              v-for="message in controller.messages.value"
              :key="message.id"
              class="legacy-message"
              :class="`is-${message.role}`"
            >
              <strong>{{
                message.role === "user"
                  ? t("legacyHistoryYou")
                  : t("legacyHistoryAssistant")
              }}</strong>
              <MessageMarkdown :content="message.content" />
            </article>
            <p v-if="!controller.messages.value.length" class="legacy-empty">
              {{ t("legacyHistoryEmptyMessages") }}
            </p>
          </div>
        </div>
        <p v-else class="legacy-empty">{{ t("legacyHistoryUnavailable") }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.legacy-dialog-backdrop {
  position: fixed;
  z-index: 1200;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 38%);
}

.legacy-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(1100px, 100%);
  height: min(760px, 90vh);
  min-height: 300px;
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-main);
  color: var(--text-primary);
  box-shadow: 0 18px 60px rgb(0 0 0 / 24%);
}

.legacy-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.legacy-dialog-header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.legacy-dialog-body {
  display: grid;
  grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
  min-height: 0;
}

.legacy-session-list,
.legacy-message-list {
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.legacy-session-list {
  border-right: 1px solid var(--theme-line-soft);
}

.legacy-session {
  display: grid;
  width: 100%;
  gap: 5px;
  margin-bottom: 6px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.legacy-session:hover,
.legacy-session.selected {
  border-color: var(--theme-line);
  background: var(--surface-selected);
}

.legacy-session span {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legacy-message {
  margin: 0 auto 16px;
  padding: 14px 16px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}

.legacy-message.is-user {
  background: var(--surface-muted);
}

.legacy-message > strong {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.legacy-empty {
  padding: 24px;
  color: var(--text-secondary);
  text-align: center;
}

@media (max-width: 680px) {
  .legacy-dialog-backdrop {
    padding: 8px;
  }

  .legacy-dialog-body {
    grid-template-columns: 135px minmax(0, 1fr);
  }
}
</style>
