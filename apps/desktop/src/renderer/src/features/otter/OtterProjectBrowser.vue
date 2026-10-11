<script setup lang="ts">
import PopupSelect from "../../components/PopupSelect.vue";
import type { OtterWorkbenchModel } from "./useOtterWorkbench";
const {
  t,
  projectId,
  projectView,
  loading,
  filter,
  selectedPath,
  document,
  documents,
  selectedProject,
  projectOptions,
  format,
  selectProject,
  openDocument
} = defineProps<{ model: OtterWorkbenchModel }>().model;
</script>
<template>
  <div class="otter-overview">
    <aside class="otter-browser panel">
      <label class="field-label" for="otter-project">{{ t("projects") }}</label>
      <PopupSelect
        id="otter-project"
        data-testid="otter-project-select"
        :model-value="projectId"
        :options="projectOptions"
        :accessible-label="t('projects')"
        :placeholder="t('selectProject')"
        @update:model-value="selectProject(String($event))"
      />
      <div v-if="selectedProject" class="otter-project-meta">
        <span>{{ selectedProject.title }}</span>
        <details>
          <summary>{{ t("projectDetails") }}</summary>
          <small>{{ selectedProject.relativePath }}</small>
          <small>{{
            selectedProject.hasProtocol
              ? t("protocolReady")
              : t("protocolMissing")
          }}</small>
        </details>
      </div>
      <label class="field-label" for="otter-filter">{{ t("documents") }}</label>
      <input
        id="otter-filter"
        v-model="filter"
        type="search"
        :placeholder="t('searchDocuments')"
      />
      <div class="otter-document-list">
        <button
          v-for="item in documents"
          :key="item.path"
          class="otter-document-item"
          :class="{ active: selectedPath === item.path }"
          type="button"
          @click="openDocument(item.path)"
        >
          <span>{{ item.title }}</span
          ><small>{{ item.category }} · {{ item.status }}</small>
        </button>
        <p v-if="!documents.length" class="muted">{{ t("noDocuments") }}</p>
      </div>
    </aside>
    <main class="otter-source panel">
      <div class="otter-panel-heading">
        <div>
          <h2>
            {{
              documents.find((item) => item.path === selectedPath)?.title ||
              t("selectDocument")
            }}
          </h2>
          <small>{{ t("documentReadOnly") }}</small>
        </div>
      </div>
      <details v-if="document" class="otter-document-location">
        <summary>{{ t("documentLocation") }}</summary>
        <code>{{ document.path }}</code>
      </details>
      <pre v-if="document" class="otter-source-text">{{
        document.content
      }}</pre>
      <div v-else class="otter-empty-state">
        {{ loading ? t("loading") : t("selectDocument") }}
      </div>
    </main>
  </div>
  <details v-if="projectView" class="otter-protocol-details">
    <summary>{{ t("protocolDetails") }}</summary>
    <pre>{{ format(projectView.protocolSummary) }}</pre>
  </details>
</template>
