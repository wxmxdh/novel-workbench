<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type {
  AgentTeamCatalogSnapshot,
  ModelConfig,
  OtterDiscussionInput,
  OtterDiscussionResult,
  OtterProjectView
} from "@deepwrite/contracts";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { uiMessage } from "../../ui-feedback";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  contextRef,
  inspectSources,
  type TeamRunSelection
} from "./teamRunSelection";
import PopupSelect from "../../components/PopupSelect.vue";

const t = createScopedTranslator("components.otterWorkbench");
const settingsStore = useSettingsStore();

const props = defineProps<{
  projectId: string;
  topic: string;
  sources: string[];
  skills: NonNullable<OtterDiscussionInput["skills"]>;
  targetPath?: string;
  models: ModelConfig[];
  parentModelId: string;
  documents: OtterProjectView["documents"];
}>();
const emit = defineEmits<{ close: []; run: [selection: TeamRunSelection] }>();
const catalog = ref<AgentTeamCatalogSnapshot>();
const dialog = ref<HTMLElement | null>(null);
const preparedTeamSignature = ref<string>();
let previousFocus: HTMLElement | null = null;
const selected = ref<string[]>([]);
const excluded = ref<string[]>([]);
const topic = ref(props.topic);
const target = ref(props.targetPath ?? "");
const targetOptions = computed(() => [
  { value: "", label: t("teamRunNoTarget") },
  ...props.documents
    .filter((item) => ["plan", "draft"].includes(item.category))
    .map((item) => ({
      value: item.path,
      label: `${item.title} · ${item.path}`
    }))
]);
const inheritedModelId = computed(
  () => props.parentModelId || settingsStore.modelSettings?.defaultModelId || ""
);
const mode = ref<"review" | "ideas">("review");
const includePeople = ref(true);
const busy = ref(false);
const prepared = ref<OtterDiscussionResult>();
const evidence = ref<ReturnType<typeof inspectSources>>();
const teams = computed(
  () =>
    catalog.value?.teams.filter((team) => team.workspaceType === "long") ?? []
);
const members = computed(() =>
  teams.value.flatMap((team) => {
    if (team.workspaceType !== "long" || !selected.value.includes(team.id))
      return [];
    return (
      team.settings.teams.find((parent) => parent.parentAgentId === "long")
        ?.subagents ?? []
    )
      .filter((member) => member.enabled)
      .map((member) => {
        const modelId =
          member.modelMode === "custom"
            ? member.modelId
            : inheritedModelId.value;
        const model = props.models.find((item) => item.id === modelId);
        return {
          key: `${team.id}/${member.id}`,
          name: member.name,
          team: team.name,
          role: member.systemPrompt,
          model: model?.label ?? t("teamRunNoModel"),
          available: Boolean(
            model && model.enabled !== false && model.hasApiKey
          )
        };
      });
  })
);
const selectedMembers = computed(() =>
  members.value.filter((member) => !excluded.value.includes(member.key))
);
watch(
  [
    topic,
    mode,
    selected,
    excluded,
    includePeople,
    target,
    () => props.sources,
    () => props.skills,
    () => props.parentModelId,
    () => props.models,
    () => settingsStore.modelSettings?.defaultModelId
  ],
  () => {
    prepared.value = undefined;
    evidence.value = undefined;
    preparedTeamSignature.value = undefined;
  },
  { deep: true }
);
onMounted(async () => {
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  document.addEventListener("keydown", handleModalKeydown, true);
  await nextTick();
  dialog.value?.focus();
  try {
    catalog.value = await window.deepwrite!.agentTeams.list();
    const active = catalog.value.enabledTeamIds.long;
    if (active) selected.value = [active];
  } catch (error) {
    uiMessage.error(formatError(error, t("teamRunConfigFailed")));
  }
});
function focusableElements(): HTMLElement[] {
  return [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
    ) ?? [])
  ].filter((element) => !element.hasAttribute("hidden"));
}
function handleModalKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (!busy.value) emit("close");
    return;
  }
  if (event.key !== "Tab") return;
  const elements = focusableElements();
  const first = elements[0];
  const last = elements.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }
  const active = document.activeElement;
  if (!dialog.value?.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && (active === first || active === dialog.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === dialog.value)) {
    event.preventDefault();
    first.focus();
  }
}
function selectedTeamDefinitionSignature(
  snapshot: AgentTeamCatalogSnapshot
): string {
  return JSON.stringify(
    snapshot.teams
      .filter((team) => selected.value.includes(team.id))
      .map((team) => ({
        id: team.id,
        name: team.name,
        workspaceType: team.workspaceType,
        settings: team.settings
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
}
function modelsSignature(): string {
  return JSON.stringify(
    props.models.map((model) => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      modelId: model.modelId,
      requestModelId: model.requestModelId,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      defaultThinkingLevel: model.defaultThinkingLevel,
      thinkingLevelOptions: model.thinkingLevelOptions,
      temperatureOptions: model.temperatureOptions,
      enabled: model.enabled,
      hasApiKey: model.hasApiKey
    }))
  );
}
function selectionSignature(snapshot: AgentTeamCatalogSnapshot): string {
  return JSON.stringify([
    props.projectId,
    props.sources,
    props.skills,
    target.value,
    inheritedModelId.value,
    topic.value,
    mode.value,
    selected.value,
    excluded.value,
    selectedMembers.value.map((member) => member.key),
    includePeople.value,
    snapshot.enabledTeamIds.long,
    selectedTeamDefinitionSignature(snapshot),
    modelsSignature()
  ]);
}
function pruneRemovedTeams(snapshot: AgentTeamCatalogSnapshot): void {
  const available = new Set(
    snapshot.teams
      .filter((team) => team.workspaceType === "long")
      .map((team) => team.id)
  );
  selected.value = selected.value.filter((id) => available.has(id));
}
onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleModalKeydown, true);
  if (previousFocus?.isConnected) previousFocus.focus();
  previousFocus = null;
});
function toggleTeam(id: string, checked: boolean) {
  if (checked && selected.value.length >= 4) {
    uiMessage.info(t("teamRunMaxTeams"));
    return;
  }
  selected.value = checked
    ? [...selected.value, id]
    : selected.value.filter((item) => item !== id);
}
function toggleMember(key: string, checked: boolean) {
  excluded.value = checked
    ? excluded.value.filter((item) => item !== key)
    : [...excluded.value, key];
}
async function prepare() {
  if (!topic.value.trim() || !selectedMembers.value.length) {
    uiMessage.info(t("teamRunNeedTopicAndMember"));
    return;
  }
  if (selectedMembers.value.some((member) => !member.available)) {
    uiMessage.error(t("teamRunModelUnavailable"));
    return;
  }
  busy.value = true;
  try {
    const latestCatalog = await window.deepwrite!.agentTeams.list();
    catalog.value = latestCatalog;
    pruneRemovedTeams(latestCatalog);
    if (!topic.value.trim() || !selectedMembers.value.length) {
      uiMessage.info(t("teamRunNeedTopicAndMember"));
      return;
    }
    if (selectedMembers.value.some((member) => !member.available)) {
      uiMessage.error(t("teamRunModelUnavailable"));
      return;
    }
    const signature = selectionSignature(latestCatalog);
    const context = await window.deepwrite!.otter!.prepareDiscussion({
      projectId: props.projectId,
      topic: topic.value.trim(),
      sources: [...props.sources],
      skills: [...props.skills],
      ...(target.value ? { targetPath: target.value } : {}),
      includeProjectPeople: includePeople.value
    });
    const verified = inspectSources(
      (await window.deepwrite!.otter!.context(contextRef(context))).apiText
    );
    if (signature !== selectionSignature(catalog.value ?? latestCatalog)) {
      uiMessage.info(t("teamRunSelectionChanged"));
      return;
    }
    evidence.value = verified;
    prepared.value = context;
    preparedTeamSignature.value = signature;
  } catch (error) {
    uiMessage.error(formatError(error, t("teamRunPrepareFailed")));
  } finally {
    busy.value = false;
  }
}
async function run() {
  if (!prepared.value || busy.value || !preparedTeamSignature.value) return;
  busy.value = true;
  try {
    const latestCatalog = await window.deepwrite!.agentTeams.list();
    if (selectionSignature(latestCatalog) !== preparedTeamSignature.value) {
      catalog.value = latestCatalog;
      pruneRemovedTeams(latestCatalog);
      prepared.value = undefined;
      evidence.value = undefined;
      preparedTeamSignature.value = undefined;
      uiMessage.info(t("teamRunSelectionChanged"));
      return;
    }
    emit("run", {
      context: prepared.value,
      topic: topic.value.trim(),
      nativeTeamIds: [...selected.value],
      memberKeys: selectedMembers.value.map((member) => member.key),
      mode: mode.value,
      includeProjectPeople: includePeople.value,
      ...(target.value ? { targetPath: target.value } : {})
    });
  } catch (error) {
    prepared.value = undefined;
    evidence.value = undefined;
    preparedTeamSignature.value = undefined;
    uiMessage.error(formatError(error, t("teamRunConfigFailed")));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop team-run-overlay"
      @mousedown.self="!busy && emit('close')"
      @keydown.esc.stop="!busy && emit('close')"
    >
      <section
        ref="dialog"
        class="team-run-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-run-title"
        tabindex="-1"
      >
        <header>
          <h2 id="team-run-title">{{ t("teamRunTitle") }}</h2>
          <button
            class="header-text-button"
            :disabled="busy"
            @click="emit('close')"
          >
            {{ t("close") }}
          </button>
        </header>
        <p>
          {{ t("teamRunIntro") }}
        </p>
        <label
          >{{ t("teamRunTopic")
          }}<textarea
            v-model="topic"
            maxlength="2000"
            :disabled="busy"
            :placeholder="t('teamRunTopicPlaceholder')"
          />
        </label>
        <div class="team-run-options">
          <label
            ><input
              v-model="mode"
              type="radio"
              value="review"
              :disabled="busy"
            />{{ t("teamRunReviewMode") }}</label
          ><label
            ><input
              v-model="mode"
              type="radio"
              value="ideas"
              :disabled="busy"
            />{{ t("teamRunIdeasMode") }}</label
          >
        </div>
        <fieldset :disabled="busy">
          <legend>{{ t("teamRunTeams") }}</legend>
          <p v-if="!teams.length">
            {{ t("teamRunNoTeams") }}
          </p>
          <label v-for="team in teams" :key="team.id" class="team-run-check"
            ><input
              type="checkbox"
              :checked="selected.includes(team.id)"
              @change="
                toggleTeam(team.id, ($event.target as HTMLInputElement).checked)
              "
            />{{ team.name }}</label
          >
        </fieldset>
        <div class="team-run-members">
          <article v-for="member in members" :key="member.key">
            <label class="team-run-check"
              ><input
                type="checkbox"
                :disabled="busy"
                :checked="!excluded.includes(member.key)"
                @change="
                  toggleMember(
                    member.key,
                    ($event.target as HTMLInputElement).checked
                  )
                "
              /><strong>{{ member.name }}</strong></label
            >
            <span>{{ member.team }} · {{ member.model }}</span>
            <details>
              <summary>{{ t("teamRunRole") }}</summary>
              <p>{{ member.role }}</p>
            </details>
          </article>
        </div>
        <fieldset :disabled="busy">
          <legend>{{ t("teamRunSources") }}</legend>
          <label
            >{{ t("teamRunTarget")
            }}<PopupSelect
              :model-value="target"
              :options="targetOptions"
              :accessible-label="t('teamRunTarget')"
              :disabled="busy"
              @update:model-value="target = String($event)"
          /></label>
          <p>
            {{
              target
                ? t("teamRunTargetSelected", { path: target })
                : t("teamRunTargetEmpty")
            }}
          </p>
          <p>
            {{ t("teamRunSourceSummary", { count: sources.length }) }}
          </p>
          <label class="team-run-check"
            ><input v-model="includePeople" type="checkbox" />{{
              t("teamRunIncludePeople")
            }}</label
          >
        </fieldset>
        <section
          v-if="evidence"
          class="team-run-evidence"
          data-testid="team-source-evidence"
        >
          <strong>{{
            t("teamRunEvidenceCount", { count: evidence.sources.length })
          }}</strong>
          <p>
            {{
              evidence.selectedOutline
                ? t("teamRunOutlineEvidence", {
                    volume: evidence.volume ?? t("teamRunVolumeUnknown"),
                    chapter: evidence.chapter ?? t("teamRunChapterUnknown"),
                    outline: evidence.selectedOutline
                  })
                : t("teamRunNoOutlineEvidence")
            }}
          </p>
          <p>
            {{ t("teamRunReadBoundary") }}
          </p>
          <details>
            <summary>{{ t("teamRunEvidenceDetails") }}</summary>
            <ul>
              <li v-for="(source, index) in evidence.sources" :key="index">
                <strong>{{ source.path }}</strong
                ><span
                  >{{ source.role }} ·
                  {{ source.authority ?? t("teamRunAuthorityByEntry") }} · L{{
                    source.line_start
                  }}–{{ source.line_end }} ·
                  {{
                    source.full
                      ? t("teamRunFullSource")
                      : t("teamRunSelectedRange")
                  }}</span
                >
              </li>
            </ul>
          </details>
        </section>
        <footer>
          <button class="secondary-button" :disabled="busy" @click="prepare">
            {{ busy ? t("teamRunChecking") : t("teamRunCheck") }}</button
          ><button
            class="primary-button"
            :disabled="busy || !prepared"
            data-testid="start-team-run"
            @click="run"
          >
            {{ t("teamRunStart", { count: selectedMembers.length }) }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.team-run-overlay {
  z-index: 1200;
}
.team-run-dialog {
  width: min(780px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow: 0 18px 60px #0003;
}
header,
footer,
.team-run-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 1.4em;
}
p,
article span,
li span {
  color: var(--text-secondary);
  font-size: 0.92em;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
label {
  display: grid;
  gap: 8px;
}
textarea {
  width: 100%;
  min-height: 90px;
  padding: 12px;
  box-sizing: border-box;
  resize: vertical;
  color: inherit;
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  font: inherit;
}
fieldset {
  margin: 16px 0;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  padding: 12px;
}
.team-run-check,
.team-run-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}
.team-run-members {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
article {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
}
article details {
  margin-top: 8px;
}
li {
  margin: 10px 0;
  overflow-wrap: anywhere;
}
li span {
  display: block;
}
footer {
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: 20px;
}
</style>
