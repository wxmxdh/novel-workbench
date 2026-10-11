<script setup lang="ts">
import { computed } from "vue";
import MessageMarkdown from "./MessageMarkdown.vue";
import StreamingMarkdown from "./StreamingMarkdown.vue";
import StreamingText from "./StreamingText.vue";

const props = withDefaults(
  defineProps<{
    content: string;
    format: "markdown" | "plain";
    streaming?: boolean;
  }>(),
  { streaming: false }
);

// Thinking explicitly stays plain. Extremely large output also remains one text
// node so a model trace cannot monopolize the renderer with repeated DOM rebuilds.
const MAX_SAFE_MARKDOWN_LENGTH = 100_000;
const usePlainText = computed(
  () =>
    props.format === "plain" || props.content.length > MAX_SAFE_MARKDOWN_LENGTH
);
</script>

<template>
  <StreamingText v-if="usePlainText" :content="content" />
  <StreamingMarkdown
    v-else-if="streaming"
    :content="content"
    :streaming="streaming"
  />
  <MessageMarkdown v-else :content="content" />
</template>
