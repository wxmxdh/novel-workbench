<script setup lang="ts">
import type { LoveReviewCoverage } from "@deepwrite/contracts";
import { loveReviewCoverageLabel } from "./loveReviewCoveragePresentation";

defineProps<{ coverage: LoveReviewCoverage }>();
</script>

<template>
  <aside
    class="subagent-review-coverage"
    :class="`is-${coverage.state}`"
    role="status"
    data-love-review-coverage
  >
    {{ loveReviewCoverageLabel(coverage) }}
  </aside>
</template>
