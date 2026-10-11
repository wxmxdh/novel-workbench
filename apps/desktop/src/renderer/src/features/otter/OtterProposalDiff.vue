<script setup lang="ts">
import { computed } from "vue";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import { createScopedTranslator } from "../../i18n";

const props = defineProps<{ before: string; after: string }>();
const t = createScopedTranslator("components.otterWorkbench");
const diff = computed(() =>
  buildAgentTextDiff(props.before, props.after, {
    contextLines: 2,
    maxRenderedLines: 1200
  })
);

function mark(type: "context" | "addition" | "deletion"): string {
  return type === "addition" ? "+" : type === "deletion" ? "−" : " ";
}
</script>

<template>
  <section class="otter-diff" aria-label="Candidate draft diff">
    <p class="otter-diff-summary">
      {{ t("diffSummary", { added: diff.additions, removed: diff.deletions }) }}
    </p>
    <div v-if="diff.hunks.length" class="otter-diff-content">
      <div
        v-for="(hunk, hunkIndex) in diff.hunks"
        :key="hunkIndex"
        class="otter-diff-hunk"
      >
        <div class="otter-diff-hunk-heading">
          @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{ hunk.newStart }},{{
            hunk.newLines
          }}
          @@
        </div>
        <div
          v-for="(line, lineIndex) in hunk.lines"
          :key="`${hunkIndex}-${lineIndex}`"
          class="otter-diff-line"
          :class="`is-${line.type}`"
        >
          <span class="line-number">{{ line.oldLineNumber ?? "" }}</span>
          <span class="line-number">{{ line.newLineNumber ?? "" }}</span>
          <span aria-hidden="true">{{ mark(line.type) }}</span>
          <code>{{ line.text }}</code>
        </div>
      </div>
    </div>
    <p v-else class="otter-diff-empty">{{ t("noDiff") }}</p>
    <p v-if="diff.truncated" class="otter-diff-limit">
      {{ t("diffTruncated") }}
    </p>
  </section>
</template>

<style scoped>
.otter-diff {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.otter-diff-summary,
.otter-diff-empty,
.otter-diff-limit {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.otter-diff-content {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  font: 12px/1.55 var(--font-mono, Consolas, monospace);
}
.otter-diff-hunk + .otter-diff-hunk {
  border-top: 1px solid var(--theme-line);
}
.otter-diff-hunk-heading {
  padding: 4px 8px;
  color: var(--text-secondary);
  background: var(--surface-muted);
}
.otter-diff-line {
  display: grid;
  grid-template-columns: 34px 34px 14px minmax(0, 1fr);
  gap: 5px;
  padding: 0 7px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.otter-diff-line code {
  font: inherit;
}
.line-number {
  color: var(--text-tertiary);
  text-align: right;
  user-select: none;
}
.is-addition {
  background: color-mix(in srgb, var(--accent-soft) 60%, transparent);
}
.is-deletion {
  background: color-mix(in srgb, #c85454 10%, transparent);
}
</style>
