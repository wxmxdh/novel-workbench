<script setup lang="ts">
defineProps<{ kind: "thinking" | "execution" }>();
</script>

<template>
  <svg
    class="conversation-status-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="kind === 'thinking'">
      <path d="M12 18V5" />
      <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
      <path d="M17.6 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.6 1.5" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path d="M18 18a4 4 0 0 0 2-7.464" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path d="M6 18a4 4 0 0 1-2-7.464" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
    </template>
    <template v-else>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m7 8 4 4-4 4M13 16h4" />
    </template>
  </svg>
</template>

<style scoped>
.conversation-status-icon {
  flex: 0 0 16px;
}
</style>
