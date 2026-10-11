<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
const t = createScopedTranslator("components.otterManualReview");
type DiscussionMessage = {
  role: "author" | "assistant";
  label: string;
  content: string;
};
defineProps<{
  messages: DiscussionMessage[];
  summary?: string | null;
}>();
</script>

<template>
  <section class="discussion-card" :aria-label="t('discussionRecord')">
    <div class="discussion-heading">
      <strong>{{ t("discussionHeading") }}</strong>
      <span v-if="summary?.trim()">{{ t("discussionSummaryIncluded") }}</span>
      <span v-else-if="messages.length">{{
        t("discussionMessagesIncluded", { count: messages.length })
      }}</span>
      <span v-else>{{ t("discussionEmpty") }}</span>
    </div>
    <details v-if="summary?.trim() || messages.length">
      <summary>{{ t("viewDiscussionRecord") }}</summary>
      <pre v-if="summary?.trim()">{{ summary }}</pre>
      <article v-else v-for="(message, index) in messages" :key="index">
        <small
          >{{ message.role === "author" ? t("author") : t("model") }} ·
          {{ message.label }}</small
        >
        <pre>{{ message.content }}</pre>
      </article>
    </details>
  </section>
</template>

<style scoped>
.discussion-card {
  border: 1px solid var(--theme-line-soft, #ded8d0);
  border-radius: 12px;
  padding: 12px;
  background: var(--surface-raised, #fffdfa);
}
.discussion-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: baseline;
}
.discussion-heading span,
.discussion-card article small {
  color: var(--text-secondary, #756e67);
}
.discussion-card details {
  margin-top: 8px;
}
.discussion-card article + article {
  border-top: 1px solid var(--theme-line-soft, #ded8d0);
  margin-top: 8px;
  padding-top: 8px;
}
.discussion-card article pre {
  margin: 6px 0 0;
}
.discussion-card pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
