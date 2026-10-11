<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type { ChatContextCompaction } from "../types/conversation";
import ConversationDetails from "./ConversationDetails.vue";
import {
  visibleCompaction,
  compactionReasonKeys,
  compactionTokenSourceKeys
} from "./conversationCompactionPresentation";

const t = createScopedTranslator(
  "components.conversationContextCompactionNotice"
);

const props = defineProps<{ compactions: readonly ChatContextCompaction[] }>();

const visible = computed(() => props.compactions.filter(visibleCompaction));

function formatTokens(value: number | undefined): string {
  return value === undefined ? "—" : new Intl.NumberFormat().format(value);
}

function reason(item: ChatContextCompaction): string {
  return t(compactionReasonKeys[item.reason]);
}

function title(item: ChatContextCompaction): string {
  if (item.status === "failed") return t("compactionFailed");
  if (item.status === "unchanged") return t("compactionUnchanged");
  if (item.status === "running") {
    return item.reason === "manual"
      ? t("manualCompactionInProgress")
      : t("automaticCompactionInProgress");
  }
  if (item.level === "summary" || item.checkpoint) {
    return t(
      item.reason === "manual"
        ? "manualSummaryCompleted"
        : "automaticSummaryCompleted",
      { arg0: reason(item) }
    );
  }
  return t("pruneCompleted", { arg0: reason(item) });
}

function detailId(item: ChatContextCompaction): string {
  return `context-compaction:${item.id}`;
}
</script>

<template>
  <div
    v-if="visible.length"
    class="context-compaction-notices"
    :aria-label="t('contextCompaction')"
  >
    <div
      v-for="item in visible"
      :key="item.id"
      class="context-compaction-notice"
      :data-status="item.status"
    >
      <ConversationDetails
        v-if="item.checkpoint || item.diagnostics || item.errorMessage"
        :detail-id="detailId(item)"
      >
        <template #summary>
          <span class="context-compaction-title">{{ title(item) }}</span>
          <span
            v-if="item.tokensBefore !== undefined"
            class="context-compaction-meta"
          >
            {{
              t("tokenDelta", {
                arg0: formatTokens(item.tokensBefore),
                arg1: formatTokens(item.tokensAfter)
              })
            }}
          </span>
          <span class="context-compaction-meta">{{ t("viewDetails") }}</span>
        </template>
        <div class="context-compaction-details">
          <p v-if="item.errorMessage" class="context-compaction-error">
            {{ item.errorMessage }}
          </p>
          <template v-if="item.checkpoint">
            <p class="context-compaction-summary-label">
              {{ t("checkpointSummary") }}
              <span class="context-compaction-meta">
                {{
                  item.checkpoint.schemaVersion === undefined
                    ? t("checkpointVersionUnknown")
                    : t("checkpointVersion", {
                        arg0: item.checkpoint.schemaVersion
                      })
                }}
              </span>
            </p>
            <pre class="context-compaction-summary">{{
              item.checkpoint.summary
            }}</pre>
          </template>
          <dl v-if="item.diagnostics" class="context-compaction-diagnostics">
            <div>
              <dt>{{ t("trigger") }}</dt>
              <dd>{{ reason(item) }}</dd>
            </div>
            <div>
              <dt>{{ t("operation") }}</dt>
              <dd>
                {{
                  item.level === "summary" || item.checkpoint
                    ? t("summaryLevel")
                    : item.level === "prune"
                      ? t("pruneLevel")
                      : t("operationUnknown")
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t("tokensBeforeAfter") }}</dt>
              <dd>
                {{
                  t("tokenDelta", {
                    arg0: formatTokens(item.tokensBefore),
                    arg1: formatTokens(item.tokensAfter)
                  })
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t("configuredAndEffectiveBudget") }}</dt>
              <dd>
                {{
                  t("budgetPair", {
                    arg0: formatTokens(item.diagnostics.configuredBudgetTokens),
                    arg1: formatTokens(item.diagnostics.workingBudgetTokens)
                  })
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t("modelWindowAndLimit") }}</dt>
              <dd>
                {{
                  t("windowPair", {
                    arg0: formatTokens(
                      item.diagnostics.modelContextWindowTokens
                    ),
                    arg1: formatTokens(item.diagnostics.hardLimitTokens)
                  })
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t("automaticThresholds") }}</dt>
              <dd>
                {{
                  t("thresholdPair", {
                    arg0: formatTokens(item.diagnostics.pruneAtTokens),
                    arg1: formatTokens(item.diagnostics.summarizeAtTokens)
                  })
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t("fixedContextEstimate") }}</dt>
              <dd>{{ formatTokens(item.diagnostics.fixedContextTokens) }}</dd>
            </div>
            <div>
              <dt>{{ t("tokenSource") }}</dt>
              <dd>
                {{ t(compactionTokenSourceKeys[item.diagnostics.tokenSource]) }}
              </dd>
            </div>
          </dl>
          <p v-if="!item.diagnostics" class="context-compaction-meta">
            {{ t("diagnosticsUnavailable") }}
          </p>
        </div>
      </ConversationDetails>
      <p v-else class="context-compaction-line">
        <span class="context-compaction-title">{{ title(item) }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.context-compaction-notices {
  display: grid;
  gap: 3px;
  margin-bottom: 5px;
}

.context-compaction-notice {
  color: var(--text-tertiary);
  font-size: 0.82em;
}

.context-compaction-notice[data-status="failed"] {
  color: var(--text-secondary);
}

.context-compaction-notice :deep(summary),
.context-compaction-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 3px 8px;
  margin: 0;
  cursor: default;
}

.context-compaction-notice :deep(summary) {
  cursor: pointer;
  list-style: none;
}

.context-compaction-notice :deep(summary::-webkit-details-marker) {
  display: none;
}

.context-compaction-title {
  color: var(--text-secondary);
}

.context-compaction-notice[data-status="running"] .context-compaction-title {
  color: var(--accent);
}

.context-compaction-meta {
  color: var(--text-tertiary);
}

.context-compaction-details {
  display: grid;
  gap: 8px;
  margin: 6px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.context-compaction-error,
.context-compaction-summary-label {
  margin: 0;
}

.context-compaction-error {
  color: var(--text-primary);
}

.context-compaction-summary-label {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.context-compaction-summary {
  max-height: 360px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-raised);
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.context-compaction-diagnostics {
  display: grid;
  gap: 5px;
  margin: 0;
}

.context-compaction-diagnostics > div {
  display: grid;
  grid-template-columns: minmax(120px, 0.4fr) minmax(0, 1fr);
  gap: 6px 12px;
}

.context-compaction-diagnostics dt {
  color: var(--text-tertiary);
}

.context-compaction-diagnostics dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
