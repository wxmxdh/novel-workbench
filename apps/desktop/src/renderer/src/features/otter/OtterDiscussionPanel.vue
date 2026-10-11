<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { OtterContextRef } from "@deepwrite/contracts";
import OtterChatPanel from "./OtterChatPanel.vue";
import OtterTeamPanel from "./OtterTeamPanel.vue";
import { createScopedTranslator } from "../../i18n";
import { uiMessage } from "../../ui-feedback";

type Source = { value: string; label: string };
type Prepared = OtterContextRef & { contextId: string };
type DiscussionApi = {
  prepareDiscussion(input: {
    projectId: string;
    topic: string;
    sources: string[];
  }): Promise<Prepared>;
  saveConcept(input: {
    projectId: string;
    title: string;
    content: string;
  }): Promise<unknown>;
};
const props = defineProps<{
  projectId: string;
  sources: Source[];
  active: boolean;
}>();
const emit = defineEmits<{
  openModels: [];
  openManualReview: [];
  contextReady: [context: Prepared | null];
}>();
const t = createScopedTranslator("components.otterWorkbench");
const topic = ref("");
const selectedSources = ref<string[]>([]);
const context = ref<Prepared | null>(null);
const preparing = ref(false);
const suggestion = ref("");
const suggestionTitle = ref("");
const saving = ref(false);
const teamOpen = ref(false);
const teamMaterial = ref("");
const api = computed(
  () => window.deepwrite?.otter as unknown as DiscussionApi | undefined
);

watch(
  () => props.projectId,
  () => {
    topic.value = "";
    selectedSources.value = [];
    context.value = null;
    suggestion.value = "";
    teamMaterial.value = "";
    teamOpen.value = false;
    emit("contextReady", null);
  }
);

async function startDiscussion(): Promise<void> {
  if (!api.value || !props.projectId || !topic.value.trim()) return;
  preparing.value = true;
  try {
    context.value = await api.value.prepareDiscussion({
      projectId: props.projectId,
      topic: topic.value.trim(),
      sources: [...selectedSources.value]
    });
    emit("contextReady", context.value);
  } catch (reason) {
    uiMessage.error(reason instanceof Error ? reason.message : String(reason));
  } finally {
    preparing.value = false;
  }
}

function captureSuggestion(content: string): void {
  suggestion.value = content;
  if (!suggestionTitle.value)
    suggestionTitle.value = topic.value.trim() || t("discussionCandidateTitle");
}

function reviewDiscussion(material: string): void {
  teamMaterial.value = material;
  teamOpen.value = true;
}

function resetDiscussionScope(): void {
  context.value = null;
  teamMaterial.value = "";
  teamOpen.value = false;
  emit("contextReady", null);
}

async function saveSuggestion(): Promise<void> {
  if (!api.value || !suggestion.value.trim() || !suggestionTitle.value.trim())
    return;
  saving.value = true;
  try {
    await api.value.saveConcept({
      projectId: props.projectId,
      title: suggestionTitle.value.trim(),
      content: suggestion.value.trim()
    });
    suggestion.value = "";
    suggestionTitle.value = "";
    uiMessage.success(t("conceptSaved"));
  } catch (reason) {
    uiMessage.error(reason instanceof Error ? reason.message : String(reason));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="otter-discussion-panel">
    <header class="otter-discussion-docket">
      <div>
        <span class="otter-eyebrow">{{ t("discussionDocket") }}</span>
        <h2>{{ topic || t("startWithQuestion") }}</h2>
        <p>{{ t("discussionCandidateBoundary") }}</p>
      </div>
      <button
        v-if="context"
        class="secondary-button"
        type="button"
        data-testid="otter-send-to-team"
        @click="teamOpen = !teamOpen"
      >
        {{ teamOpen ? t("hideTeam") : t("sendToTeam") }}
      </button>
    </header>

    <section v-if="!context" class="otter-discussion-setup panel">
      <label>
        <span>{{ t("discussionTopic") }}</span>
        <textarea
          v-model="topic"
          rows="3"
          maxlength="8000"
          :placeholder="t('discussionTopicHint')"
        />
      </label>
      <details v-if="sources.length" class="otter-discussion-sources">
        <summary>
          {{ t("chooseDiscussionSources", { count: selectedSources.length }) }}
        </summary>
        <label v-for="source in sources" :key="source.value">
          <input
            v-model="selectedSources"
            type="checkbox"
            :value="source.value"
          />
          <span>{{ source.label }}</span>
        </label>
      </details>
      <p>{{ t("projectDiscussionScope") }}</p>
      <button
        class="primary-button"
        type="button"
        :disabled="!topic.trim() || preparing"
        @click="startDiscussion"
      >
        {{ preparing ? t("preparingDiscussion") : t("beginDiscussion") }}
      </button>
    </section>

    <section v-else class="otter-discussion-live panel">
      <div class="otter-discussion-context">
        <span
          >{{ t("discussionSources") }} ·
          {{
            selectedSources.length ? selectedSources.length : t("wholeProject")
          }}</span
        >
        <button class="text-button" type="button" @click="resetDiscussionScope">
          {{ t("changeDiscussionScope") }}
        </button>
      </div>
      <OtterChatPanel
        :project-id="projectId"
        :context="context"
        :active="active"
        @stage-candidate="captureSuggestion"
        @review-discussion="reviewDiscussion"
        @open-models="emit('openModels')"
        @open-manual-review="emit('openManualReview')"
      />
      <OtterTeamPanel
        v-if="teamOpen"
        :project-id="projectId"
        :context="context"
        :topic="topic"
        :material="teamMaterial"
        @open-models="emit('openModels')"
      />
    </section>

    <section v-if="suggestion" class="otter-discussion-candidate panel">
      <div class="otter-panel-heading">
        <h2>{{ t("discussionCandidateTitle") }}</h2>
        <span>{{ t("candidateStatus") }}</span>
      </div>
      <input v-model="suggestionTitle" :aria-label="t('conceptTitle')" />
      <textarea v-model="suggestion" rows="8" />
      <p>{{ t("discussionCandidateBoundary") }}</p>
      <button
        class="primary-button"
        type="button"
        :disabled="saving"
        @click="saveSuggestion"
      >
        {{ saving ? t("saving") : t("saveAsOpenIdea") }}
      </button>
    </section>
  </section>
</template>
