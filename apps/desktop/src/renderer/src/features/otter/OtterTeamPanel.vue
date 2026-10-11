<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import type {
  OtterContextRef,
  OtterTeams,
  OtterTeamPlan,
  ModelSettings,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import { uiMessage } from "../../ui-feedback";
import PopupSelect from "../../components/PopupSelect.vue";
const props = defineProps<{
  projectId: string;
  context: (OtterContextRef & { contextId: string }) | null;
  topic?: string;
  material?: string;
  settingsOnly?: boolean;
}>();
defineEmits<{ openModels: [] }>();
const t = createScopedTranslator("components.otterTeam");
const settings = ref<OtterTeams>({ teams: [] }),
  models = ref<ModelSettings | null>(null),
  loaded = ref(false),
  editing = ref(!!props.settingsOnly),
  selected = ref<string[]>([]),
  focus = ref(props.topic ?? ""),
  mode = ref<"review" | "ideas">("review"),
  running = ref(false);
type Row = {
  name: string;
  team: string;
  sessionId: string;
  runId: string;
  content: string;
  status: "pending" | "working" | "completed" | "failed" | "stopped";
  error: string;
};
const rows = ref<Row[]>([]),
  ideaTitle = ref(""),
  ideaContent = ref("");
let unsubscribe: (() => void) | undefined;
let epoch = 0;
const pendingResolvers = new Map<string, () => void>();
const modelOptions = computed(() => [
  { value: "", label: t("defaultModel") },
  ...(models.value?.models ?? []).map((model) => ({
    value: model.id,
    label: model.label
  }))
]);
const count = computed(() =>
  settings.value.teams
    .filter((team) => selected.value.includes(team.id))
    .reduce((n, team) => n + team.members.filter((m) => m.enabled).length, 0)
);
const ready = computed(
  () =>
    !!props.context &&
    count.value > 0 &&
    !!models.value?.models.length &&
    !!focus.value.trim() &&
    !running.value
);
watch(
  () => props.topic,
  (value) => {
    if (value) focus.value = value;
  }
);
watch(
  () => [props.projectId, props.context?.contextId] as const,
  async () => {
    await stop();
    rows.value = [];
  }
);
watch(
  () => props.settingsOnly,
  (value) => {
    editing.value = !!value;
  }
);
onMounted(async () => {
  try {
    const api = window.deepwrite;
    if (!api?.otter) return;
    [settings.value, models.value] = await Promise.all([
      api.otter.teams(),
      api.models.list()
    ]);
    selected.value = settings.value.teams.map((team) => team.id);
    unsubscribe = api.events.subscribe(handleEvent);
  } catch (error) {
    showError(error);
  } finally {
    loaded.value = true;
  }
});
function showError(error: unknown) {
  uiMessage.error(error instanceof Error ? error.message : String(error));
}
function handleEvent(event: SystemEventEnvelope) {
  if (!("sessionId" in event.payload)) return;
  const sessionId = event.payload.sessionId;
  const row = rows.value.find((value) => value.sessionId === sessionId);
  if (!row || row.status === "stopped") return;
  if ("runId" in event.payload && typeof event.payload.runId === "string")
    row.runId = event.payload.runId;
  if (event.type === "agent.message_delta") row.content += event.payload.delta;
  else if (event.type === "agent.message_completed") {
    row.content = event.payload.content;
    row.status =
      event.payload.stopReason === "aborted" ? "stopped" : "completed";
    pendingResolvers.get(row.sessionId)?.();
  } else if (event.type === "agent.error") {
    row.error = event.payload.message;
    row.status = "failed";
    pendingResolvers.get(row.sessionId)?.();
  }
}
async function save() {
  try {
    settings.value = await window.deepwrite!.otter!.saveTeams(settings.value);
    uiMessage.success(t("saved"));
  } catch (error) {
    showError(error);
  }
}
function addTeam() {
  settings.value.teams.push({
    id: crypto.randomUUID(),
    name: t("teamDefault", { count: settings.value.teams.length + 1 }),
    members: [
      {
        id: crypto.randomUUID(),
        name: t("memberDefault", { count: 1 }),
        role: t("roleDefault"),
        enabled: true
      }
    ]
  });
}
function addMember(team: OtterTeams["teams"][number]) {
  team.members.push({
    id: crypto.randomUUID(),
    name: t("memberDefault", { count: team.members.length + 1 }),
    role: t("roleDefault"),
    enabled: true
  });
}
function chooseModel(
  member: OtterTeams["teams"][number]["members"][number],
  value: string
) {
  if (value) member.modelId = value;
  else delete member.modelId;
}
async function runMember(
  member: OtterTeamPlan["members"][number],
  generation: number
) {
  if (generation !== epoch) return;
  const row = rows.value.find(
    (value) => value.sessionId === member.request.sessionId
  )!;
  const sessionId = row.sessionId;
  row.status = "working";
  await new Promise<void>((resolve) => {
    pendingResolvers.set(sessionId, resolve);
    window.deepwrite!.extrasAgents.run(member.request).then(
      (accepted) => {
        if (generation !== epoch || row.status === "stopped") {
          void window.deepwrite?.session
            .abort({ sessionId, runId: accepted.runId })
            .catch(showError);
          row.status = "stopped";
          resolve();
          return;
        }
        row.runId = accepted.runId;
      },
      (error) => {
        if (generation !== epoch || row.status === "stopped") {
          row.status = "stopped";
          resolve();
          return;
        }
        row.status = "failed";
        row.error = error instanceof Error ? error.message : String(error);
        resolve();
      }
    );
  }).finally(() => pendingResolvers.delete(sessionId));
}
async function start() {
  if (!props.context || !ready.value) return;
  if ((props.material?.length ?? 0) > 12000 || focus.value.length > 2000) {
    uiMessage.error(t("tooLong"));
    return;
  }
  running.value = true;
  const generation = ++epoch;
  try {
    await save();
    const plan = await window.deepwrite!.otter!.prepareTeam({
      context: {
        projectId: props.context.projectId,
        contextPath: props.context.contextPath,
        receiptPath: props.context.receiptPath
      },
      teamIds: selected.value,
      topic: focus.value,
      mode: mode.value,
      ...(props.material ? { material: props.material } : {})
    });
    if (generation !== epoch) return;
    rows.value = plan.members.map((member) => ({
      name: member.memberName,
      team: member.teamName,
      sessionId: member.request.sessionId,
      runId: "",
      content: "",
      status: "pending",
      error: ""
    }));
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, plan.members.length) }, async () => {
        while (generation === epoch && next < plan.members.length) {
          const member = plan.members[next++]!;
          await runMember(member, generation);
        }
      })
    );
  } catch (error) {
    showError(error);
  } finally {
    if (generation === epoch) running.value = false;
  }
}
async function stop() {
  ++epoch;
  const active = rows.value.filter((row) => row.status === "working");
  for (const row of rows.value) {
    if (row.status === "pending" || row.status === "working")
      row.status = "stopped";
    pendingResolvers.get(row.sessionId)?.();
  }
  running.value = false;
  await Promise.allSettled(
    active.map((row) =>
      row.runId
        ? window.deepwrite?.session.abort({
            sessionId: row.sessionId,
            runId: row.runId
          })
        : Promise.resolve()
    )
  );
}
function keep(row: Row) {
  ideaTitle.value = `${focus.value || t("defaultTitle")} · ${row.name}`;
  ideaContent.value = row.content;
}
async function saveIdea() {
  try {
    await window.deepwrite!.otter!.saveConcept({
      projectId: props.projectId,
      title: ideaTitle.value,
      content: ideaContent.value
    });
    uiMessage.success(t("ideaSaved"));
    ideaContent.value = "";
  } catch (error) {
    showError(error);
  }
}
onBeforeUnmount(() => {
  void stop();
  unsubscribe?.();
});
</script>
<template>
  <section class="otter-team panel" data-testid="otter-team-panel">
    <header class="otter-team-heading">
      <div>
        <h2>{{ t("title") }}</h2>
        <p>{{ t("subtitle") }}</p>
      </div>
      <div class="otter-context-actions">
        <button
          type="button"
          class="secondary-button"
          @click="$emit('openModels')"
        >
          {{ t("models") }}</button
        ><button
          v-if="!settingsOnly"
          type="button"
          class="secondary-button"
          @click="editing = !editing"
        >
          {{ t("settings") }}
        </button>
      </div>
    </header>
    <p v-if="!loaded">{{ t("loading") }}</p>
    <div v-if="editing || settingsOnly" class="otter-team-settings">
      <article
        v-for="(team, teamIndex) in settings.teams"
        :key="team.id"
        class="otter-team-config"
      >
        <div class="otter-context-actions">
          <input
            v-model="team.name"
            :aria-label="t('teamName')"
            maxlength="80"
          /><button
            type="button"
            class="text-button"
            @click="settings.teams.splice(teamIndex, 1)"
          >
            {{ t("remove") }}
          </button>
        </div>
        <div
          v-for="(member, index) in team.members"
          :key="member.id"
          class="otter-team-member"
        >
          <label
            ><input v-model="member.enabled" type="checkbox" />{{
              t("enabled")
            }}</label
          ><input
            v-model="member.name"
            :aria-label="t('memberName')"
            maxlength="80"
          />
          <PopupSelect
            :model-value="member.modelId ?? ''"
            :options="modelOptions"
            :accessible-label="t('model')"
            @update:model-value="chooseModel(member, String($event))"
          />
          <textarea
            v-model="member.role"
            rows="2"
            maxlength="4000"
            :aria-label="t('role')"
          />
          <button
            type="button"
            class="text-button"
            :disabled="team.members.length < 2"
            @click="team.members.splice(index, 1)"
          >
            {{ t("remove") }}
          </button>
        </div>
        <button
          type="button"
          class="secondary-button"
          :disabled="team.members.length >= 8"
          @click="addMember(team)"
        >
          {{ t("addMember") }}
        </button>
      </article>
      <div class="otter-context-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="settings.teams.length >= 8"
          @click="addTeam"
        >
          {{ t("addTeam") }}</button
        ><button type="button" class="primary-button" @click="save">
          {{ t("save") }}
        </button>
      </div>
    </div>
    <template v-if="!settingsOnly">
      <p v-if="!context" class="muted">{{ t("noContext") }}</p>
      <p v-if="!models?.models.length" class="muted">{{ t("noModels") }}</p>
      <fieldset class="otter-team-choice">
        <legend>{{ t("choose") }}</legend>
        <label v-for="team in settings.teams" :key="team.id"
          ><input
            v-model="selected"
            type="checkbox"
            :value="team.id"
            :disabled="running"
          />{{ team.name }}</label
        >
      </fieldset>
      <label
        >{{ t("topic")
        }}<textarea
          v-model="focus"
          rows="2"
          maxlength="2000"
          :disabled="running"
        />
      </label>
      <details v-if="material">
        <summary>{{ t("expand") }}</summary>
        <p>{{ t("materialHint") }}</p>
        <pre>{{ material }}</pre>
      </details>
      <div class="otter-context-actions">
        <PopupSelect
          :model-value="mode"
          :options="[
            { value: 'review', label: t('review') },
            { value: 'ideas', label: t('ideas') }
          ]"
          :accessible-label="t('choose')"
          @update:model-value="mode = $event === 'ideas' ? 'ideas' : 'review'"
        /><button
          v-if="!running"
          type="button"
          class="primary-button"
          :disabled="!ready"
          @click="start"
        >
          {{ t("start", { count }) }}</button
        ><button v-else type="button" class="secondary-button" @click="stop">
          {{ t("stop") }}
        </button>
      </div>
      <p v-if="!rows.length" class="muted">{{ t("empty") }}</p>
      <article
        v-for="row in rows"
        :key="row.sessionId"
        class="otter-team-result"
      >
        <header>
          <strong>{{ row.team }} · {{ row.name }}</strong
          ><span>{{ t(row.status) }}</span>
        </header>
        <p v-if="row.error">{{ row.error }}</p>
        <pre v-else>{{ row.content }}</pre>
        <button
          v-if="row.status === 'completed' && row.content"
          type="button"
          class="text-button"
          @click="keep(row)"
        >
          {{ t("candidate") }}
        </button>
      </article>
      <div v-if="ideaContent" class="otter-team-idea">
        <input v-model="ideaTitle" :aria-label="t('ideaTitle')" /><textarea
          v-model="ideaContent"
          rows="6"
        /><button type="button" class="primary-button" @click="saveIdea">
          {{ t("saveIdea") }}
        </button>
      </div>
    </template>
  </section>
</template>
<style scoped>
.otter-team {
  display: grid;
  gap: 14px;
}
.otter-team-heading,
.otter-team-result header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}
.otter-team-heading h2 {
  margin: 0;
  font-size: 16px;
}
.otter-team-heading p {
  margin: 5px 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.otter-team-settings {
  display: grid;
  gap: 14px;
}
.otter-team-config {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--theme-line);
  border-radius: 12px;
}
.otter-team-member {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr) minmax(150px, 1fr) auto;
  gap: 10px;
  align-items: center;
}
.otter-team-member textarea {
  grid-column: 1 / -1;
}
.otter-team label {
  display: grid;
  gap: 5px;
}
.otter-team-member label,
.otter-team-choice label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.otter-team-choice {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
}
.otter-team pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 440px;
  overflow: auto;
  font: 14px/1.8 var(--font-ui, sans-serif);
}
.otter-team-result {
  padding: 14px;
  border-radius: 12px;
  background: var(--surface-muted);
}
.otter-team-result span {
  font-size: 12px;
  color: var(--text-secondary);
}
.otter-team-idea {
  display: grid;
  gap: 8px;
}
@media (max-width: 800px) {
  .otter-team-heading {
    flex-direction: column;
  }
  .otter-team-member {
    grid-template-columns: auto 1fr;
  }
  .otter-team-member textarea {
    grid-column: 1 / -1;
  }
}
</style>
