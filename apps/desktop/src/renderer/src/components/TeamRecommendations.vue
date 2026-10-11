<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { ModelConfig } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import AppIcon from "./AppIcon.vue";
import {
  buildCombinedLongTeamPresetSettings,
  buildLongTeamPresetSettings,
  buildTeamRecommendations,
  uniqueTeamName,
  type TeamRecommendationApplyInput,
  type TeamRoleRecommendation
} from "./teamRecommendations";

const props = defineProps<{
  models: readonly ModelConfig[];
  existingTeamNames: readonly string[];
  saving: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  apply: [input: TeamRecommendationApplyInput];
}>();

const t = createScopedTranslator("components.teamRecommendations");
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
const projectNote = ref("");
const applyingId = ref<string | null>(null);
let previousFocus: HTMLElement | null = null;
let operationStarted = false;
let applyTimeout: ReturnType<typeof setTimeout> | undefined;

const recommendations = computed(() =>
  buildTeamRecommendations(props.models).map((recommendation) => ({
    ...recommendation,
    displayName: t(`preset${recommendation.id}Name`),
    roleDisplayName: t(`preset${recommendation.id}RoleName`),
    displayDescription: t(`preset${recommendation.id}Description`)
  }))
);

function clearApplyState(): void {
  applyingId.value = null;
  operationStarted = false;
  if (applyTimeout) clearTimeout(applyTimeout);
  applyTimeout = undefined;
}

watch(
  () => props.saving,
  (saving) => {
    if (saving) operationStarted = true;
    else if (operationStarted) clearApplyState();
  }
);

async function show(): Promise<void> {
  if (props.disabled || props.saving) return;
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : trigger.value;
  open.value = true;
  await nextTick();
  document.addEventListener("keydown", handleModalKeydown, true);
  dialog.value?.focus();
}

async function close(): Promise<void> {
  if (props.saving) return;
  if (!open.value) return;
  document.removeEventListener("keydown", handleModalKeydown, true);
  open.value = false;
  await nextTick();
  const target = previousFocus?.isConnected ? previousFocus : trigger.value;
  target?.focus();
  previousFocus = null;
}

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
    void close();
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

function apply(recommendation: TeamRoleRecommendation): void {
  if (applyingId.value || props.saving || props.disabled) return;
  applyingId.value = recommendation.id;
  applyTimeout = setTimeout(clearApplyState, 30_000);
  const teamName = uniqueTeamName(
    t(`preset${recommendation.id}Name`),
    props.existingTeamNames
  );
  emit("apply", {
    name: teamName,
    settings: buildLongTeamPresetSettings(recommendation, projectNote.value)
  });
}

function applyCombined(): void {
  if (applyingId.value || props.saving || props.disabled) return;
  applyingId.value = "combined";
  applyTimeout = setTimeout(clearApplyState, 30_000);
  emit("apply", {
    name: uniqueTeamName(t("combinedTeamName"), props.existingTeamNames),
    settings: buildCombinedLongTeamPresetSettings(
      recommendations.value,
      projectNote.value
    )
  });
}

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleModalKeydown, true);
  if (applyTimeout) clearTimeout(applyTimeout);
  if (open.value) previousFocus?.focus();
});
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="team-recommendations-trigger"
    :disabled="disabled || saving"
    @click="show"
  >
    <AppIcon name="sparkles" :size="16" />
    {{ t("configureTeamsFromTemplates") }}
  </button>

  <Teleport to="body">
    <div v-if="open" class="team-recommendations-backdrop" @click.self="close">
      <section
        ref="dialog"
        class="team-recommendations-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-recommendations-title"
        tabindex="-1"
      >
        <header class="team-recommendations-header">
          <div>
            <span>{{ t("basedOnYourModelsAndWorkflow") }}</span>
            <h2 id="team-recommendations-title">
              {{ t("agentRoleRecommendations") }}
            </h2>
          </div>
          <button
            type="button"
            class="team-recommendations-close"
            :aria-label="t('close')"
            :disabled="saving"
            @click="close"
          >
            ×
          </button>
        </header>

        <label class="team-recommendations-project-note">
          <span>{{ t("optionalProjectNotes") }}</span>
          <textarea
            v-model="projectNote"
            maxlength="2000"
            :placeholder="t('projectNotesPlaceholder')"
            :disabled="Boolean(applyingId) || saving"
          />
        </label>
        <p class="team-recommendations-note">
          {{ t("oneClickCreatesSavedLongTeam") }}
        </p>

        <article
          class="team-recommendation-card team-combined-recommendation-card"
        >
          <header>
            <div>
              <h3>{{ t("combinedTeamName") }}</h3>
              <strong>{{ t("combinedTeamSubtitle") }}</strong>
            </div>
            <span class="recommended-model">{{ t("fiveSpecialists") }}</span>
          </header>
          <p>{{ t("combinedTeamDescription") }}</p>
          <ul class="combined-role-list">
            <li
              v-for="recommendation in recommendations"
              :key="recommendation.id"
            >
              <span>{{ recommendation.roleDisplayName }}</span>
              <small>{{
                recommendation.modelLabel ?? t("inheritMainModel")
              }}</small>
            </li>
          </ul>
          <button
            type="button"
            class="apply-recommendation-button"
            :disabled="disabled || saving || Boolean(applyingId)"
            @click="applyCombined"
          >
            <AppIcon name="sparkles" :size="14" />
            {{
              applyingId === "combined"
                ? t("savingRecommendedTeam")
                : t("createCombinedReviewTeam")
            }}
          </button>
        </article>

        <div class="team-recommendations-list">
          <article
            v-for="recommendation in recommendations"
            :key="recommendation.id"
            class="team-recommendation-card"
          >
            <header>
              <div>
                <h3>{{ recommendation.displayName }}</h3>
                <strong>{{ recommendation.roleDisplayName }}</strong>
              </div>
              <span class="recommended-model">
                {{ recommendation.modelLabel ?? t("inheritMainModel") }}
              </span>
            </header>
            <p>{{ recommendation.displayDescription }}</p>
            <small>{{ recommendation.usage }}</small>
            <details>
              <summary>{{ t("viewSystemPrompt") }}</summary>
              <pre>{{ recommendation.systemPrompt }}</pre>
            </details>
            <button
              type="button"
              class="apply-recommendation-button"
              :disabled="disabled || saving || Boolean(applyingId)"
              @click="apply(recommendation)"
            >
              <AppIcon name="sparkles" :size="14" />
              {{
                applyingId === recommendation.id
                  ? t("savingRecommendedTeam")
                  : t("createAndSaveRecommendedTeam")
              }}
            </button>
          </article>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.team-recommendations-trigger,
.apply-recommendation-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}

.team-recommendations-trigger:hover,
.apply-recommendation-button:hover,
.team-recommendations-close:hover {
  background: var(--surface-hover);
}

.team-recommendations-trigger:disabled,
.apply-recommendation-button:disabled,
.team-recommendations-close:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.team-recommendations-backdrop {
  position: fixed;
  z-index: 2300;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, var(--surface-main) 35%, rgb(0 0 0 / 44%));
}

.team-recommendations-dialog {
  display: grid;
  gap: 14px;
  width: min(980px, 100%);
  max-height: min(90vh, 920px);
  overflow: auto;
  box-sizing: border-box;
  padding: 22px;
  color: var(--text-primary);
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  background: var(--surface-raised);
  box-shadow: 0 20px 60px rgb(0 0 0 / 24%);
}

.team-recommendations-header,
.team-recommendation-card > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.team-recommendations-header > div,
.team-recommendation-card > header > div {
  min-width: 0;
}

.team-recommendations-header > div > span,
.team-recommendations-note,
.team-recommendation-card p,
.team-recommendation-card small {
  color: var(--text-secondary);
}

.team-recommendations-header h2,
.team-recommendation-card h3 {
  margin: 4px 0 0;
}

.team-recommendations-close {
  flex: none;
  width: 36px;
  height: 36px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-main);
  color: var(--text-secondary);
  font: inherit;
  font-size: 1.35rem;
  cursor: pointer;
}

.team-recommendations-project-note {
  display: grid;
  gap: 7px;
  color: var(--text-secondary);
}

.team-recommendations-project-note textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 72px;
  resize: vertical;
  padding: 9px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.5;
}

.team-recommendations-note {
  margin: 0;
  line-height: 1.55;
}

.team-recommendations-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 265px), 1fr));
  gap: 12px;
}

.team-recommendation-card {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  padding: 15px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-main);
}

.team-combined-recommendation-card {
  border-color: color-mix(in srgb, var(--accent) 32%, var(--theme-line-soft));
}

.combined-role-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.combined-role-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.combined-role-list li > span {
  min-width: 0;
}

.combined-role-list li > small {
  flex: none;
  max-width: 52%;
  overflow-wrap: anywhere;
  text-align: right;
}

.team-recommendation-card h3 {
  font-size: 1rem;
}

.team-recommendation-card strong {
  display: block;
  margin-top: 5px;
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.recommended-model {
  max-width: 45%;
  padding: 3px 8px;
  overflow-wrap: anywhere;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.75rem;
}

.team-recommendation-card p {
  margin: 0;
  line-height: 1.5;
}

.team-recommendation-card small {
  line-height: 1.45;
}

.team-recommendation-card details {
  border-top: 1px solid var(--theme-line-soft);
  padding-top: 9px;
}

.team-recommendation-card summary {
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
}

.team-recommendation-card pre {
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8rem;
  line-height: 1.55;
}

.apply-recommendation-button {
  width: 100%;
  background: var(--surface-raised);
}

@media (max-width: 760px) {
  .team-recommendations-backdrop {
    padding: 10px;
  }

  .team-recommendations-dialog {
    max-height: 94vh;
    padding: 16px;
  }

  .team-recommendation-card > header {
    flex-direction: column;
  }

  .recommended-model {
    max-width: 100%;
  }
}
</style>
