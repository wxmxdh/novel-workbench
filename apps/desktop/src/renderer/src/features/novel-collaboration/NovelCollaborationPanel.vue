<script setup lang="ts">
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { useNovelCollaboration } from "./useNovelCollaboration";

const props = defineProps<{
  bookId: string;
  chapterCardId: string;
  snapshot: LongWorkspaceIndexSnapshot;
}>();
const emit = defineEmits<{
  openFile: [fileId: string, offset?: number];
}>();
const {
  loading,
  running,
  error,
  loadedSources,
  sourceWarning,
  requirementInstructions,
  checkedRows,
  searchQuestion,
  searchQueries,
  searchScope,
  searchLoading,
  searchRows,
  candidatePrompt,
  candidateSet,
  selectedCandidateId,
  reviewModelId,
  candidateModelIds,
  candidateSaved,
  activeTaskIds,
  savingCandidate,
  candidateNotice,
  selectedChapter,
  outlineNeedsRecheck,
  searchScopeOptions,
  reviewModelOptions,
  candidateModelOptions,
  currentCandidateSet,
  t,
  loadSources,
  runRequirementCheck,
  updateSearchScope,
  searchPrevious,
  updateCandidateModels,
  runPlotCandidates,
  cancelTask,
  chooseCandidate,
  saveSelectedCandidate,
  openSearchHit,
  openCheckedSource
} = useNovelCollaboration(props, emit);
</script>

<template>
  <section class="novel-collaboration" data-testid="novel-collaboration-panel">
    <header class="novel-collaboration__header">
      <div>
        <small>{{ t("eyebrow") }}</small>
        <h2>{{ selectedChapter?.title ?? t("chapterFallback") }}</h2>
        <p>{{ t("candidateBoundary") }}</p>
      </div>
      <button
        class="novel-collaboration__button"
        type="button"
        :disabled="loading"
        @click="loadSources"
      >
        {{ loading ? t("loading") : t("refreshSources") }}
      </button>
    </header>

    <p v-if="sourceWarning" class="novel-collaboration__notice">
      {{ sourceWarning }}
    </p>
    <p
      class="novel-collaboration__error"
      role="alert"
      aria-live="polite"
      :data-empty="!error"
    >
      {{ error }}
    </p>
    <div class="novel-collaboration__sources">
      <button
        v-for="source in loadedSources"
        :key="source.fileId"
        type="button"
        class="novel-collaboration__source"
        @click="openCheckedSource(source.fileId, source.updatedAt)"
      >
        <strong>{{
          source.role === "bookLine"
            ? t("bookLineSource")
            : source.role === "outline"
              ? source.outlineState === "selected-current"
                ? `${t("chapterPlanSource")} · ${t("selectedOutline")}`
                : source.outlineState === "selected-stale"
                  ? `${t("chapterPlanSource")} · ${t("selectedOutlineStale")}`
                  : t("chapterPlanUnselected")
              : t("draftSource")
        }}</strong>
        <small v-if="source.outlineVersion">{{ source.outlineVersion }}</small>
        <span>{{ source.path }}</span>
        <small>{{ t("sourceVersion") }} · {{ source.updatedAt }}</small>
      </button>
      <p
        v-if="!loadedSources.length && !loading"
        class="novel-collaboration__empty"
      >
        {{ t("noChapterSources") }}
      </p>
    </div>

    <section class="novel-collaboration__section">
      <h3>{{ t("requirementTitle") }}</h3>
      <p>{{ t("requirementHint") }}</p>
      <textarea
        v-model="requirementInstructions"
        :placeholder="t('requirementPlaceholder')"
        rows="4"
      />
      <div class="novel-collaboration__row">
        <PopupSelect
          v-model="reviewModelId"
          :options="reviewModelOptions"
          :accessible-label="t('reviewModel')"
          :placeholder="t('selectReviewModel')"
          :disabled="running || !reviewModelOptions.length"
        />
        <button
          class="novel-collaboration__primary"
          type="button"
          :disabled="
            !reviewModelId ||
            !loadedSources.length ||
            !requirementInstructions.trim() ||
            running ||
            outlineNeedsRecheck
          "
          @click="runRequirementCheck"
        >
          {{ running ? t("reviewRunning") : t("reviewAction") }}
        </button>
      </div>
      <div v-if="checkedRows.length" class="novel-collaboration__checks">
        <article
          v-for="row in checkedRows"
          :key="row.check.id"
          class="novel-collaboration__check"
          :data-stale="row.stale"
        >
          <div class="novel-collaboration__check-title">
            <strong>{{ row.check.requirement }}</strong>
            <span :class="`status-${row.check.status}`">{{
              row.stale
                ? t("sourceStale")
                : row.check.status === "supported"
                  ? t("supported")
                  : row.check.status === "missing"
                    ? t("missing")
                    : t("uncertain")
            }}</span>
          </div>
          <small
            >{{
              row.check.kind === "must-appear"
                ? t("kindMustAppear")
                : row.check.kind === "must-preserve"
                  ? t("kindMustPreserve")
                  : row.check.kind === "background"
                    ? t("kindBackground")
                    : t("kindExploration")
            }}<template v-if="row.check.note">
              · {{ row.check.note }}</template
            ></small
          >
          <blockquote
            v-for="(evidence, index) in row.check.evidence"
            :key="`${evidence.source.fileId}-${index}`"
          >
            <button
              type="button"
              @click="
                openCheckedSource(
                  evidence.source.fileId,
                  evidence.source.updatedAt,
                  evidence.start
                )
              "
            >
              {{ evidence.quote }}
            </button>
            <small
              >{{ evidence.explanation }} · {{ evidence.source.path }} ·
              {{ evidence.source.updatedAt }}</small
            >
          </blockquote>
          <p
            v-if="
              row.check.status === 'supported' && !row.check.evidence.length
            "
            class="novel-collaboration__error"
          >
            {{ t("evidenceRequired") }}
          </p>
        </article>
      </div>
    </section>

    <section class="novel-collaboration__section">
      <h3>{{ t("searchTitle") }}</h3>
      <p>{{ t("searchHint") }}</p>
      <textarea
        v-model="searchQuestion"
        :placeholder="t('searchPlaceholder')"
        rows="2"
      />
      <div class="novel-collaboration__row">
        <label
          >{{ t("searchScope") }}
          <PopupSelect
            :model-value="searchScope"
            :options="searchScopeOptions"
            :accessible-label="t('searchScope')"
            variant="compact"
            @update:model-value="updateSearchScope"
        /></label>
        <button
          class="novel-collaboration__primary"
          type="button"
          :disabled="searchLoading || !searchQuestion.trim()"
          @click="searchPrevious"
        >
          {{ searchLoading ? t("searching") : t("searchAction") }}
        </button>
      </div>
      <div v-if="searchQueries.length" class="novel-collaboration__terms">
        {{ t("searchTerms") }}：{{ searchQueries.join("、") }}
      </div>
      <button
        v-for="row in searchRows"
        :key="`${row.fileId}:${row.start}`"
        type="button"
        class="novel-collaboration__hit"
        @click="openSearchHit(row)"
      >
        <strong>{{ row.path }}</strong
        ><small>{{ row.updatedAt }}</small
        ><span>{{ row.snippet }}</span>
      </button>
    </section>

    <section class="novel-collaboration__section">
      <h3>{{ t("candidateTitle") }}</h3>
      <p>{{ t("candidateHint") }}</p>
      <textarea
        v-model="candidatePrompt"
        :placeholder="t('candidatePlaceholder')"
        rows="3"
      />
      <div class="novel-collaboration__row">
        <PopupSelect
          model-value=""
          :options="candidateModelOptions"
          :accessible-label="t('candidateModels')"
          :placeholder="t('selectCandidateModels')"
          multiple
          :selected-values="candidateModelIds"
          :selected-summary="
            t('selectedModels', { count: candidateModelIds.length })
          "
          :disabled="running || !candidateModelOptions.length"
          @update:selected-values="updateCandidateModels"
        />
        <button
          class="novel-collaboration__primary"
          type="button"
          :disabled="
            candidateModelIds.length === 0 ||
            running ||
            !candidatePrompt.trim() ||
            !loadedSources.length ||
            outlineNeedsRecheck
          "
          @click="runPlotCandidates"
        >
          {{ running ? t("candidateRunning") : t("runCandidates") }}
        </button>
      </div>
      <p v-if="activeTaskIds.length" class="novel-collaboration__hint">
        <button type="button" @click="cancelTask">
          {{ t("cancelTasks") }}
        </button>
      </p>
      <p
        v-if="candidateSet && !currentCandidateSet"
        class="novel-collaboration__notice"
      >
        {{ t("candidateStale") }}
      </p>
      <p v-if="candidateNotice" class="novel-collaboration__notice">
        {{ candidateNotice }}
      </p>
      <div
        v-if="candidateSet"
        class="novel-collaboration__candidates"
        :data-stale="!currentCandidateSet"
      >
        <article
          v-for="candidate in candidateSet.candidates"
          :key="candidate.id"
          class="novel-collaboration__candidate"
          :class="{ selected: selectedCandidateId === candidate.id }"
        >
          <header>
            <strong>{{ candidate.model }}</strong
            ><small>{{ candidate.createdAt }}</small>
          </header>
          <pre>{{ candidate.body }}</pre>
          <button
            class="novel-collaboration__button"
            type="button"
            :disabled="!currentCandidateSet"
            @click="chooseCandidate(candidate.id)"
          >
            {{
              selectedCandidateId === candidate.id
                ? t("candidateSelected")
                : t("selectCandidate")
            }}
          </button>
        </article>
      </div>
      <div v-if="selectedCandidateId" class="novel-collaboration__row">
        <span class="novel-collaboration__hint">{{
          t("candidateNotCanon")
        }}</span
        ><button
          type="button"
          class="novel-collaboration__primary"
          :disabled="candidateSaved || savingCandidate || !currentCandidateSet"
          @click="saveSelectedCandidate"
        >
          {{ candidateSaved ? t("candidateSaved") : t("saveCandidate") }}
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped src="./novel-collaboration.css"></style>
