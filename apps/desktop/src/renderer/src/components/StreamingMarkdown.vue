<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdown } from "../utils/renderMarkdown";
import { createStreamingMarkdownScheduler } from "./streamingMarkdownScheduler";

const props = withDefaults(
  defineProps<{
    content: string;
    streaming?: boolean;
  }>(),
  { streaming: false }
);

let renderedContent = props.content;
const html = ref(renderMarkdown(renderedContent));

function renderContent(): void {
  if (props.content === renderedContent) return;
  renderedContent = props.content;
  html.value = renderMarkdown(renderedContent);
}

const scheduler = createStreamingMarkdownScheduler(renderContent);

watch(
  [() => props.content, () => props.streaming],
  () => {
    if (props.streaming) {
      scheduler.schedule();
      return;
    }
    scheduler.flush();
  },
  { flush: "post" }
);

onBeforeUnmount(scheduler.dispose);
</script>

<template>
  <!-- renderMarkdown escapes source text before adding its allowlisted HTML subset. -->
  <div
    class="markdown-content message-markdown streaming-markdown"
    v-html="html"
  />
</template>
