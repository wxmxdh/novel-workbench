<script setup lang="ts">
import PopupSelect from "../../components/PopupSelect.vue";
import type { OtterWorkbenchModel } from "./useOtterWorkbench";
const {
  t,
  projectId,
  busy,
  task,
  chapter,
  volume,
  contextPath,
  receiptPath,
  planPath,
  workflowAction,
  workflowInput,
  taskPov,
  taskTarget,
  taskAuthorInstructions,
  taskCharacters,
  taskRelationships,
  taskKnowledgeBoundary,
  taskUnknowns,
  taskScope,
  volumeEvidencePath,
  volumeEvidenceQuote,
  authorizationPath,
  authorizationQuote,
  sourceRefsJson,
  sourceSelections,
  authorIntent,
  routeResult,
  workflowResult,
  contextResult,
  contextView,
  candidateTitle,
  candidateBody,
  candidateAuthorIntent,
  projectDocumentOptions,
  planDocumentOptions,
  chatContext,
  originalDraft,
  workflowActionOptions,
  taskOptions,
  requiresIntent,
  format,
  selectTask,
  selectWorkflowAction,
  selectScope,
  selectTarget,
  selectVolumeEvidence,
  selectAuthorizationEvidence,
  selectPlan,
  runRoute,
  runWorkflow,
  loadContext,
  useAssistantReply,
  stageDraft
} = defineProps<{ model: OtterWorkbenchModel }>().model;
import OtterChatPanel from "./OtterChatPanel.vue";
import OtterProposalDiff from "./OtterProposalDiff.vue";
const sourceRows = [
  ["character", "sourceCharacter"],
  ["relationship", "sourceRelationship"],
  ["timeline", "sourceTimeline"],
  ["knowledge", "sourceKnowledge"],
  ["scene", "sourceScene"],
  ["unknown", "sourceUnknown"]
] as const;
</script>
<template>
  <div class="otter-workflow">
    <section class="panel otter-workflow-controls">
      <h2>{{ t("workflow") }}</h2>
      <div class="otter-form-grid">
        <label
          ><span>{{ t("chapter") }}</span
          ><input v-model.number="chapter" type="number" min="1" max="100000"
        /></label>
        <label
          ><span>{{ t("volume") }}</span
          ><input v-model="volume" type="text"
        /></label>
        <label
          ><span>{{ t("task") }}</span
          ><PopupSelect
            data-testid="otter-task-select"
            :model-value="task"
            :options="taskOptions"
            :accessible-label="t('task')"
            @update:model-value="selectTask(String($event))"
        /></label>
      </div>
      <button
        class="secondary-button"
        type="button"
        data-testid="otter-route"
        :disabled="busy === 'route'"
        @click="runRoute"
      >
        {{ t("route") }}
      </button>
      <pre v-if="routeResult" class="otter-json-result">{{
        format(routeResult)
      }}</pre>
      <hr />
      <details class="otter-task-builder" open>
        <summary>{{ t("prepareForm") }}</summary>
        <p class="otter-boundary-note">{{ t("prepareFormHint") }}</p>
        <div class="otter-form-grid">
          <label
            ><span>{{ t("taskScope") }}</span
            ><PopupSelect
              data-testid="otter-scope-select"
              :model-value="taskScope"
              :options="[
                { value: 'chapter', label: t('chapterScope') },
                { value: 'fragment', label: t('fragmentScope') }
              ]"
              :accessible-label="t('taskScope')"
              @update:model-value="selectScope(String($event))"
          /></label>
          <label
            ><span>{{ t("pov") }}</span
            ><input v-model="taskPov" type="text"
          /></label>
          <label class="wide"
            ><span>{{ t("targetPath") }}</span
            ><PopupSelect
              data-testid="otter-target-select"
              :model-value="taskTarget"
              :options="projectDocumentOptions"
              :accessible-label="t('targetPath')"
              :placeholder="t('selectProjectDocument')"
              @update:model-value="selectTarget(String($event))"
          /></label>
        </div>
        <label class="field-label" for="otter-task-characters">{{
          t("relevantCharacters")
        }}</label>
        <textarea
          id="otter-task-characters"
          v-model="taskCharacters"
          :placeholder="t('onePerLine')"
        />
        <label class="field-label" for="otter-task-relationships">{{
          t("relevantRelationships")
        }}</label>
        <textarea
          id="otter-task-relationships"
          v-model="taskRelationships"
          :placeholder="t('onePerLine')"
        />
        <label class="field-label" for="otter-task-instructions">{{
          t("authorInstructions")
        }}</label>
        <textarea
          id="otter-task-instructions"
          v-model="taskAuthorInstructions"
          :placeholder="t('onePerLine')"
        />
        <label class="field-label" for="otter-task-boundary">{{
          t("knowledgeBoundary")
        }}</label>
        <textarea
          id="otter-task-boundary"
          v-model="taskKnowledgeBoundary"
          :placeholder="t('onePerLine')"
        />
        <label class="field-label" for="otter-task-unknowns">{{
          t("intentionalUnknowns")
        }}</label>
        <textarea
          id="otter-task-unknowns"
          v-model="taskUnknowns"
          :placeholder="t('onePerLine')"
        />
        <section class="otter-source-reference-list">
          <h3>{{ t("sourceReferences") }}</h3>
          <p class="otter-boundary-note">{{ t("sourceReferencesHint") }}</p>
          <div
            v-for="[role, label] in sourceRows"
            :key="role"
            class="otter-source-reference-row"
          >
            <strong>{{ t(label) }}</strong>
            <PopupSelect
              :data-testid="`otter-source-${role}`"
              :model-value="sourceSelections[role].path"
              :options="projectDocumentOptions"
              :accessible-label="t(label)"
              :placeholder="t('selectProjectDocument')"
              @update:model-value="sourceSelections[role].path = String($event)"
            />
            <input
              v-model="sourceSelections[role].section"
              :aria-label="t('sourceSection')"
              :placeholder="t('sourceSection')"
              type="text"
            />
          </div>
        </section>
        <div class="otter-form-grid">
          <label
            ><span>{{ t("volumeEvidencePath") }}</span
            ><PopupSelect
              data-testid="otter-volume-evidence-select"
              :model-value="volumeEvidencePath"
              :options="projectDocumentOptions"
              :accessible-label="t('volumeEvidencePath')"
              :placeholder="t('selectProjectDocument')"
              @update:model-value="selectVolumeEvidence(String($event))"
          /></label>
          <label
            ><span>{{ t("volumeEvidenceQuote") }}</span
            ><input v-model="volumeEvidenceQuote" type="text"
          /></label>
        </div>
        <div
          v-if="['draft', 'continue', 'revise'].includes(task)"
          class="otter-form-grid"
        >
          <label
            ><span>{{ t("authorizationPath") }}</span
            ><PopupSelect
              data-testid="otter-authorization-evidence-select"
              :model-value="authorizationPath"
              :options="projectDocumentOptions"
              :accessible-label="t('authorizationPath')"
              :placeholder="t('selectProjectDocument')"
              @update:model-value="selectAuthorizationEvidence(String($event))"
          /></label>
          <label
            ><span>{{ t("authorizationQuote") }}</span
            ><input v-model="authorizationQuote" type="text"
          /></label>
        </div>
        <details class="otter-advanced-sources">
          <summary>{{ t("advancedSources") }}</summary>
          <label class="field-label" for="otter-source-refs">{{
            t("sourceRefs")
          }}</label
          ><textarea
            id="otter-source-refs"
            v-model="sourceRefsJson"
            spellcheck="false"
          />
        </details>
      </details>
      <label class="field-label" for="otter-context-path">{{
        t("contextPath")
      }}</label
      ><input
        id="otter-context-path"
        v-model="contextPath"
        type="text"
        placeholder=".novel/context/CTX-….json"
      />
      <label class="field-label" for="otter-receipt-path">{{
        t("receiptPath")
      }}</label
      ><input
        id="otter-receipt-path"
        v-model="receiptPath"
        type="text"
        placeholder=".novel/receipts/RCPT-….json"
      />
      <label class="field-label" for="otter-plan-path">{{
        t("planPath")
      }}</label
      ><PopupSelect
        id="otter-plan-path"
        data-testid="otter-plan-select"
        :model-value="planPath"
        :options="planDocumentOptions"
        :accessible-label="t('planPath')"
        :placeholder="t('selectPlanDocument')"
        @update:model-value="selectPlan(String($event))"
      />
      <div class="otter-context-actions">
        <button
          class="secondary-button"
          type="button"
          data-testid="otter-prepare"
          :disabled="busy === 'prepare'"
          @click="runWorkflow('prepare')"
        >
          {{ t("prepare") }}
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="busy === 'preflight' || !contextPath"
          @click="runWorkflow('preflight')"
        >
          {{ t("preflight") }}
        </button>
        <button
          class="primary-button"
          type="button"
          data-testid="otter-load-context"
          :disabled="busy === 'context' || !contextPath"
          @click="loadContext"
        >
          {{ t("loadContext") }}
        </button>
      </div>
      <p v-if="contextResult" class="otter-context-identity">
        {{ t("contextIds") }}: {{ contextResult.contextId }}
      </p>
    </section>

    <section class="panel otter-command-controls">
      <h2>{{ t("protocolAction") }}</h2>
      <label class="field-label" for="otter-action">{{
        t("protocolAction")
      }}</label>
      <PopupSelect
        id="otter-action"
        data-testid="otter-action-select"
        :model-value="workflowAction"
        :options="workflowActionOptions"
        :accessible-label="t('protocolAction')"
        @update:model-value="selectWorkflowAction(String($event))"
      />
      <label class="field-label" for="otter-workflow-input">{{
        t("protocolInput")
      }}</label>
      <textarea
        id="otter-workflow-input"
        v-model="workflowInput"
        data-testid="otter-advanced-input"
        spellcheck="false"
      />
      <label
        v-if="requiresIntent"
        class="field-label"
        for="otter-author-intent"
        >{{ t("authorIntent") }}</label
      >
      <textarea
        v-if="requiresIntent"
        id="otter-author-intent"
        v-model="authorIntent"
      />
      <p class="otter-boundary-note">{{ t("acceptWarning") }}</p>
      <button
        class="primary-button"
        type="button"
        data-testid="otter-run-workflow"
        :disabled="Boolean(busy)"
        @click="runWorkflow()"
      >
        {{ t("runWorkflow") }}
      </button>
      <pre v-if="workflowResult" class="otter-json-result">{{
        format(workflowResult)
      }}</pre>
    </section>

    <section class="panel otter-context-panel">
      <div class="otter-panel-heading">
        <h2>
          {{ contextView === "api" ? t("apiContext") : t("agentContext") }}
        </h2>
        <div class="otter-context-tabs">
          <button type="button" @click="contextView = 'api'">API</button
          ><button type="button" @click="contextView = 'agent'">Agent</button>
        </div>
      </div>
      <pre v-if="contextResult" class="otter-context-text">{{
        contextView === "api" ? contextResult.apiText : contextResult.agentText
      }}</pre>
      <div v-else class="otter-empty-state">{{ t("noChatContext") }}</div>
    </section>

    <section class="panel otter-chat-container">
      <OtterChatPanel
        :project-id="projectId"
        :context="chatContext"
        @stage-candidate="useAssistantReply"
      />
    </section>

    <section class="panel otter-proposal-panel">
      <div class="otter-panel-heading">
        <div>
          <h2>{{ t("stageTitle") }}</h2>
          <p>{{ t("stageHint") }}</p>
        </div>
      </div>
      <label class="field-label" for="otter-candidate-title">{{
        t("stageTitle")
      }}</label
      ><input id="otter-candidate-title" v-model="candidateTitle" type="text" />
      <label class="field-label" for="otter-candidate-body">{{
        t("stageBody")
      }}</label
      ><textarea id="otter-candidate-body" v-model="candidateBody" />
      <label class="field-label" for="otter-stage-intent">{{
        t("authorIntent")
      }}</label
      ><textarea id="otter-stage-intent" v-model="candidateAuthorIntent" />
      <OtterProposalDiff :before="originalDraft" :after="candidateBody" />
      <button
        class="primary-button"
        type="button"
        data-testid="otter-stage-draft"
        :disabled="busy === 'stage'"
        @click="stageDraft"
      >
        {{ t("stageDraft") }}
      </button>
    </section>
  </div>
</template>
