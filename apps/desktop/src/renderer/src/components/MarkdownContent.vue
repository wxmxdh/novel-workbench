<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../utils/renderMarkdown";

const props = withDefaults(
  defineProps<{ content: string; annotateHeadings?: boolean }>(),
  { annotateHeadings: false }
);
const html = computed(() =>
  renderMarkdown(props.content, {
    annotateHeadings: props.annotateHeadings
  })
);
</script>

<template>
  <!-- renderMarkdown escapes source text before adding its allowlisted HTML subset. -->
  <div class="markdown-content" v-html="html" />
</template>
