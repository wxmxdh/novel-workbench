<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import { uiMessage } from "../ui-feedback";
import MarkdownContent from "./MarkdownContent.vue";
import {
  projectLongPlotContinuity,
  projectLongPlotPlanningBoard
} from "../utils/longPlotPlanningBoard";

const t = createScopedTranslator("components.longWorkspaceEditor");
const props = defineProps<{
  index: LongWorkspaceIndexSnapshot;
  locked: boolean;
}>();
const displayedIndex = ref(props.index);
const outlineSelectionChapterId = ref<string | null>(null);
const outlineSelectionVersion = ref("");
type NativeWritingPanel = {
  loading: boolean;
  loaded?: Awaited<
    ReturnType<
      NonNullable<typeof window.deepwrite>["long"]["listNativeWriting"]
    >
  >;
  model: string;
  version: string;
  pasted: string;
  revisionOf?: { path: string; hash: string; role: "work" | "candidate" };
  changeSummary: string;
  showHistory: boolean;
};
const writingPanels = reactive<Record<string, NativeWritingPanel>>({});
watch(
  () => props.index,
  (value) => {
    displayedIndex.value = value;
  }
);
async function refreshIndex() {
  const api = window.deepwrite?.long;
  if (!api) return;
  try {
    const refreshed = await api.getWorkspaceIndex({
      bookId: displayedIndex.value.bookId
    });
    displayedIndex.value = refreshed.workspaceIndex;
  } catch {
    // Keep the current snapshot visible when Core cannot refresh the board.
  }
}
onMounted(() => void refreshIndex());
const emit = defineEmits<{
  openFile: [fileId: string];
  createVolume: [];
  createChapterCard: [];
}>();
const volumes = computed(() =>
  projectLongPlotPlanningBoard(displayedIndex.value)
);
const continuity = computed(() =>
  projectLongPlotContinuity(displayedIndex.value)
);
function beginOutlineSelection(chapterCardId: string, currentVersion?: string) {
  outlineSelectionChapterId.value = chapterCardId;
  outlineSelectionVersion.value = currentVersion ?? "";
}
async function selectOutline() {
  const chapterCardId = outlineSelectionChapterId.value;
  const version = outlineSelectionVersion.value.trim();
  if (!chapterCardId || !version) return;
  try {
    const longApi = window.deepwrite?.long;
    if (!longApi) throw new Error(t("outlineSelectionFailed"));
    await longApi.writeDocument({
      bookId: displayedIndex.value.bookId,
      selectChapterOutline: {
        chapterCardId,
        version,
        expectedIndexUpdatedAt: displayedIndex.value.updatedAt
      }
    });
    const refreshed = await longApi.getWorkspaceIndex({
      bookId: displayedIndex.value.bookId
    });
    if (refreshed) displayedIndex.value = refreshed.workspaceIndex;
    outlineSelectionChapterId.value = null;
  } catch (error) {
    uiMessage.error(
      error instanceof Error ? error.message : t("outlineSelectionFailed")
    );
  }
}
function writingPanel(chapterCardId: string): NativeWritingPanel {
  return (writingPanels[chapterCardId] ??= {
    loading: false,
    model: "unknown",
    version: "",
    pasted: "",
    changeSummary: "",
    showHistory: false
  });
}
async function openWritingPanel(chapterCardId: string, event: Event) {
  if (
    !(event.currentTarget instanceof HTMLDetailsElement) ||
    !event.currentTarget.open
  )
    return;
  const panel = writingPanel(chapterCardId);
  if (panel.loaded || panel.loading) return;
  await refreshNativeWriting(chapterCardId);
}
function toggleWritingHistory(chapterCardId: string, event: Event) {
  const target = event.currentTarget;
  if (target instanceof HTMLDetailsElement)
    writingPanel(chapterCardId).showHistory = target.open;
}
async function refreshNativeWriting(chapterCardId: string) {
  const panel = writingPanel(chapterCardId);
  const api = window.deepwrite?.long;
  if (!api) return;
  panel.loading = true;
  try {
    panel.loaded = await api.listNativeWriting({
      bookId: displayedIndex.value.bookId,
      chapterCardId
    });
  } catch (error) {
    uiMessage.error(
      error instanceof Error ? error.message : t("nativeWritingLoadFailed")
    );
  } finally {
    panel.loading = false;
  }
}
async function saveNativeWriting(
  chapterCardId: string,
  role: "work" | "candidate",
  source: "current" | "pasted"
) {
  const panel = writingPanel(chapterCardId);
  const loaded = panel.loaded;
  if (!loaded) return;
  const work = loaded.items.find((item) => item.role === "work");
  try {
    await window.deepwrite?.long.saveNativeWriting({
      bookId: loaded.bookId,
      chapterCardId,
      role,
      source,
      ...(source === "current" && loaded.currentBody
        ? { expectedCurrentBodyHash: loaded.currentBody.hash }
        : source === "pasted"
          ? { content: panel.pasted }
          : {}),
      title:
        displayedIndex.value.plot.chapterCards.find(
          (item) => item.id === chapterCardId
        )?.title ?? t("chapterCard"),
      model: panel.model.trim() || "unknown",
      version: panel.version.trim() || "unknown",
      ...(role === "work" && work ? { expectedHash: work.hash } : {}),
      ...(source === "pasted" && panel.revisionOf
        ? {
            revisionOf: {
              path: panel.revisionOf.path,
              hash: panel.revisionOf.hash
            }
          }
        : {}),
      ...(panel.changeSummary.trim()
        ? { changeSummary: panel.changeSummary.trim() }
        : {})
    });
    panel.pasted = "";
    delete panel.revisionOf;
    panel.changeSummary = "";
    await refreshNativeWriting(chapterCardId);
    uiMessage.success(t("nativeWritingSaved"));
  } catch (error) {
    uiMessage.error(
      error instanceof Error ? error.message : t("nativeWritingSaveFailed")
    );
  }
}
async function openNativeDraft(
  chapterCardId: string,
  item: NonNullable<NativeWritingPanel["loaded"]>["items"][number]
) {
  const panel = writingPanel(chapterCardId);
  try {
    const draft = await window.deepwrite?.long.readNativeWriting({
      bookId: displayedIndex.value.bookId,
      chapterCardId,
      path: item.path,
      hash: item.hash
    });
    if (!draft) return;
    panel.pasted = draft.content;
    panel.model = item.model;
    panel.version = item.version;
    panel.revisionOf = { path: draft.path, hash: draft.hash, role: draft.role };
    panel.changeSummary = "";
  } catch (error) {
    uiMessage.error(
      error instanceof Error ? error.message : t("nativeWritingLoadFailed")
    );
  }
}
async function saveEditedNativeDraft(
  chapterCardId: string,
  role: "work" | "candidate"
) {
  await saveNativeWriting(chapterCardId, role, "pasted");
}
async function selectNativeWriting(
  chapterCardId: string,
  item: NonNullable<NativeWritingPanel["loaded"]>["items"][number],
  action: "reference" | "important"
) {
  try {
    await window.deepwrite?.long.selectNativeWriting({
      bookId: displayedIndex.value.bookId,
      chapterCardId,
      path: item.path,
      hash: item.hash,
      action
    });
    await refreshNativeWriting(chapterCardId);
    uiMessage.success(
      t(
        action === "reference"
          ? "nativeWritingReferenceSaved"
          : "nativeWritingCheckpointSaved"
      )
    );
  } catch (error) {
    uiMessage.error(
      error instanceof Error ? error.message : t("nativeWritingSaveFailed")
    );
  }
}
function nativeWritingGroups(
  items: NonNullable<NativeWritingPanel["loaded"]>["items"]
) {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    if (item.role !== "candidate") continue;
    const group = groups.get(item.model) ?? [];
    group.push(item);
    groups.set(item.model, group);
  }
  return [...groups].map(([model, drafts]) => ({ model, drafts }));
}
</script>

<template>
  <section class="plot-planning-board" data-testid="plot-planning-board">
    <details class="continuity-quick-view">
      <summary>{{ t("continuityQuickView") }}</summary>
      <p v-if="!continuity.hasCommittedRecords">
        {{ t("noCommittedLedger") }}
      </p>
      <template v-else>
        <h3>{{ t("characterAndPlotState") }}</h3>
        <ul>
          <li v-for="fact in continuity.facts" :key="fact.factId">
            {{ fact.domain }} · {{ fact.field }}: {{ fact.value }} ({{
              t("sourceLabel")
            }}
            {{ fact.sourceChapterCardId }} / {{ fact.sourceCommitId }})
          </li>
        </ul>
        <h3>{{ t("knowledgeBoundaries") }}</h3>
        <ul>
          <li
            v-for="item in continuity.knowledge"
            :key="`${item.factId}-${item.audienceType}-${item.audienceId}`"
          >
            {{ item.audienceType }} {{ item.audienceId || t("readerLabel") }}:
            {{ item.fact?.value || item.factId }} ({{ item.level }};
            {{ t("sourceLabel") }} {{ item.sourceChapterCardId }})
          </li>
        </ul>
        <h3>{{ t("openQuestions") }}</h3>
        <ul>
          <li v-for="loop in continuity.openLoops" :key="loop.loopId">
            {{ loop.status }} · {{ loop.detail }} ({{ t("sourceLabel") }}
            {{ loop.sourceChapterCardId }})
          </li>
        </ul>
        <h3>{{ t("latestHandoff") }}</h3>
        <p v-if="continuity.handoff">
          {{ continuity.handoff.summary }}; {{ t("mustCarryLabel") }}:
          {{
            continuity.handoff.mustCarry.join("、") || t("noExplicitEntries")
          }}; {{ t("nextChapterConstraints") }}:
          {{
            continuity.handoff.nextChapterConstraints.join("、") ||
            t("noExplicitEntries")
          }}
        </p>
        <p v-else>{{ t("noCommittedHandoff") }}</p>
      </template>
      <h3>{{ t("foreshadowingAndPayoff") }}</h3>
      <ul>
        <li v-for="thread in continuity.foreshadowing" :key="thread.id">
          {{ thread.title }} ({{ thread.status }}):
          {{
            thread.beats
              .map(
                (beat) =>
                  `${beat.type}/${beat.status}${beat.chapterCardId ? `/${beat.chapterCardId}` : ""}`
              )
              .join("、") || t("noForeshadowingBeats")
          }}
        </li>
      </ul>
    </details>
    <header>
      <h2>{{ t("planningAndRecords") }}</h2>
      <p>{{ t("planningAndRecordsHelp") }}</p>
      <div class="board-actions">
        <button type="button" @click="emit('openFile', index.bookLine.id)">
          {{ t("overallOutline") }}
        </button>
        <button type="button" :disabled="locked" @click="emit('createVolume')">
          {{ t("newVolume") }}
        </button>
        <button
          type="button"
          :disabled="locked || !volumes.length"
          @click="emit('createChapterCard')"
        >
          {{ t("createFirstChapterCard") }}
        </button>
      </div>
    </header>
    <p v-if="!volumes.length">{{ t("planningBoardEmpty") }}</p>
    <section v-for="volume in volumes" :key="volume.id" class="planning-volume">
      <h3>{{ volume.title }}</h3>
      <details v-if="volume.summary" class="volume-summary">
        <summary>
          {{ volume.summary.slice(0, 180)
          }}{{ volume.summary.length > 180 ? "…" : "" }}
        </summary>
        <MarkdownContent :content="volume.summary" />
      </details>
      <p v-else class="volume-summary">{{ t("noVolumeOutlineYet") }}</p>
      <p v-if="!volume.chapters.length">{{ t("noChapterCardsYet") }}</p>
      <ul v-else>
        <li v-for="chapter in volume.chapters" :key="chapter.id">
          <span class="chapter-name"
            >{{ chapter.narrativeOrder }} · {{ chapter.title }}</span
          >
          <span class="chapter-status">{{
            chapter.status === "recorded"
              ? t("recordApproved")
              : chapter.status === "written"
                ? t("proseAwaitingRecord")
                : t("plannedChapter")
          }}</span>
          <span class="outline-source-status">
            {{
              !chapter.outlineSelection
                ? t("noExplicitOutline")
                : chapter.outlineSelectionStatus === "current"
                  ? t("selectedOutlineCurrent", {
                      version: chapter.outlineSelection.version
                    })
                  : chapter.outlineSelectionStatus === "needs-recheck"
                    ? t("selectedOutlineChanged", {
                        version: chapter.outlineSelection.version
                      })
                    : t("selectedOutlineUnverified", {
                        version: chapter.outlineSelection.version
                      })
            }}
          </span>
          <details
            v-if="chapter.outlineSelection"
            class="outline-source-details"
          >
            <summary>{{ t("outlineSourceDetails") }}</summary>
            <p>
              {{ t("outlineSourcePath") }}:
              {{ chapter.planPath || t("sourceUnknown") }}
            </p>
            <p>
              {{ t("outlineVersionLabel") }}:
              {{ chapter.outlineSelection.version }}
            </p>
            <code>{{ chapter.outlineSelection.sha256 }}</code>
          </details>
          <span v-if="chapter.bodyEvidenceStatus" class="chapter-status">
            {{
              chapter.bodyEvidenceStatus === "current"
                ? t("bodyMatchesRecordedVersion")
                : chapter.bodyEvidenceStatus === "needs-review"
                  ? t("bodyChangedNeedsReview")
                  : t("oldRecordNeedsReview")
            }}
          </span>
          <div class="board-actions">
            <button
              type="button"
              :disabled="!chapter.planFileId"
              @click="
                chapter.planFileId && emit('openFile', chapter.planFileId)
              "
            >
              {{ t("chapterPlan") }}
            </button>
            <button
              type="button"
              :disabled="locked || !chapter.planFileId"
              @click="
                beginOutlineSelection(
                  chapter.id,
                  chapter.outlineSelection?.version
                )
              "
            >
              {{ t("selectChapterOutline") }}
            </button>
            <button
              type="button"
              :disabled="!chapter.bodyFileId"
              @click="
                chapter.bodyFileId && emit('openFile', chapter.bodyFileId)
              "
            >
              {{ t("manuscript") }}
            </button>
            <button
              type="button"
              :disabled="!chapter.recordFileId"
              @click="
                chapter.recordFileId && emit('openFile', chapter.recordFileId)
              "
            >
              {{
                chapter.status === "written"
                  ? t("preparePlotRecord")
                  : t("plotRecord")
              }}
            </button>
            <button
              v-if="chapter.handoffFileId"
              type="button"
              @click="emit('openFile', chapter.handoffFileId)"
            >
              {{ t("chapterHandoff") }}
            </button>
          </div>
          <details
            class="native-writing-panel"
            @toggle="openWritingPanel(chapter.id, $event)"
          >
            <summary>{{ t("chapterDraftVersions") }}</summary>
            <p v-if="writingPanel(chapter.id).loading">
              {{ t("loadingChapterDraftVersions") }}
            </p>
            <template v-else-if="writingPanel(chapter.id).loaded">
              <template
                v-for="loaded in [writingPanel(chapter.id).loaded]"
                :key="loaded?.chapterCardId ?? chapter.id"
              >
                <template v-if="loaded">
                  <details
                    v-if="loaded.currentBody"
                    class="native-current-body"
                  >
                    <summary>{{ t("currentManuscript") }}</summary>
                    <pre>{{ loaded.currentBody.content }}</pre>
                    <button
                      type="button"
                      :disabled="locked"
                      @click="saveNativeWriting(chapter.id, 'work', 'current')"
                    >
                      {{ t("copyCurrentToWork") }}
                    </button>
                    <button
                      type="button"
                      :disabled="locked"
                      @click="
                        saveNativeWriting(chapter.id, 'candidate', 'current')
                      "
                    >
                      {{ t("copyCurrentToCandidate") }}
                    </button>
                  </details>
                  <p v-if="loaded.currentBodyTooLarge">
                    {{ t("currentBodyTooLarge") }}
                  </p>
                  <label
                    >{{ t("draftModelLabel")
                    }}<input
                      v-model="writingPanel(chapter.id).model"
                      maxlength="200"
                  /></label>
                  <label
                    >{{ t("draftVersionLabel")
                    }}<input
                      v-model="writingPanel(chapter.id).version"
                      maxlength="120"
                      :placeholder="t('unknownVersion')"
                  /></label>
                  <label
                    >{{ t("changeSummaryLabel")
                    }}<input
                      v-model="writingPanel(chapter.id).changeSummary"
                      maxlength="1000"
                  /></label>
                  <label
                    >{{ t("pasteComparisonDraft")
                    }}<textarea
                      v-model="writingPanel(chapter.id).pasted"
                      maxlength="100000"
                      rows="6"
                    />
                  </label>
                  <button
                    v-if="!writingPanel(chapter.id).revisionOf"
                    type="button"
                    :disabled="
                      locked || !writingPanel(chapter.id).pasted.trim()
                    "
                    @click="saveEditedNativeDraft(chapter.id, 'candidate')"
                  >
                    {{ t("savePastedCandidate") }}
                  </button>
                  <h4>{{ t("chapterWorkDraft") }}</h4>
                  <article
                    v-for="item in loaded.items.filter(
                      (entry) => entry.role === 'work'
                    )"
                    :key="item.path"
                    class="native-writing-item"
                  >
                    <strong>{{ item.title }}</strong
                    ><span>{{ item.version }} · {{ item.model }}</span>
                    <small>{{ item.path }}</small>
                    <button
                      type="button"
                      :disabled="locked"
                      @click="openNativeDraft(chapter.id, item)"
                    >
                      {{ t("openDraftForEditing") }}
                    </button>
                  </article>
                  <h4>{{ t("chapterCandidates") }}</h4>
                  <p v-if="!nativeWritingGroups(loaded.items).length">
                    {{ t("noChapterCandidates") }}
                  </p>
                  <section
                    v-if="
                      loaded.items.some(
                        (item) =>
                          item.role === 'candidate' &&
                          (item.selectedReference || item.important)
                      )
                    "
                    class="native-writing-highlights"
                    :aria-label="t('chapterCandidates')"
                  >
                    <article
                      v-for="item in loaded.items.filter(
                        (entry) =>
                          entry.role === 'candidate' &&
                          (entry.selectedReference || entry.important)
                      )"
                      :key="`${item.path}:${item.hash}`"
                      class="native-writing-highlight"
                    >
                      <strong>{{ item.title }}</strong>
                      <span>{{ item.model }} · {{ item.version }}</span>
                      <span
                        v-if="item.selectedReference"
                        class="reference-label"
                      >
                        {{ t("currentReferenceDraft") }}
                      </span>
                      <span v-if="item.important" class="checkpoint-label">
                        {{ t("importantCheckpoint") }}
                      </span>
                      <button
                        type="button"
                        :disabled="locked"
                        @click="openNativeDraft(chapter.id, item)"
                      >
                        {{ t("openDraftForEditing") }}
                      </button>
                    </article>
                  </section>
                  <details
                    class="native-writing-history"
                    @toggle="toggleWritingHistory(chapter.id, $event)"
                  >
                    <summary>
                      {{
                        t("candidateHistory", {
                          count: loaded.items.filter(
                            (entry) => entry.role === "candidate"
                          ).length
                        })
                      }}
                    </summary>
                    <template v-if="writingPanel(chapter.id).showHistory">
                      <section
                        v-for="group in nativeWritingGroups(loaded.items)"
                        :key="group.model"
                        class="native-writing-model-group"
                      >
                        <h5>{{ group.model }}</h5>
                        <article
                          v-for="item in group.drafts"
                          :key="`${item.path}:${item.hash}`"
                          class="native-writing-item"
                        >
                          <strong>{{ item.title }}</strong
                          ><span>{{ item.version }}</span>
                          <span v-if="item.important" class="checkpoint-label">
                            {{ t("importantCheckpoint") }}
                          </span>
                          <span
                            v-if="item.selectedReference"
                            class="reference-label"
                          >
                            {{ t("currentReferenceDraft") }}
                          </span>
                          <details v-if="item.sources.length">
                            <summary>
                              {{
                                t("candidateSources", {
                                  count: item.sources.length
                                })
                              }}
                            </summary>
                            <ul>
                              <li
                                v-for="(source, sourceIndex) in item.sources"
                                :key="`${source.model}:${source.version}:${sourceIndex}`"
                              >
                                {{ source.title }} · {{ source.model }} ·
                                {{ source.version }}
                                <span v-if="source.revisionOf">
                                  · {{ source.revisionOf }}</span
                                >
                                <span v-if="source.revisionOfHash">
                                  · {{ source.revisionOfHash.slice(0, 12) }}
                                </span>
                                <span v-if="source.changeSummary">
                                  · {{ source.changeSummary }}</span
                                >
                                <span v-if="source.outline">
                                  · {{ source.outline }}</span
                                >
                              </li>
                            </ul>
                          </details>
                          <small>{{ item.path }}</small>
                          <button
                            type="button"
                            :disabled="locked"
                            @click="openNativeDraft(chapter.id, item)"
                          >
                            {{ t("openDraftForEditing") }}
                          </button>
                          <button
                            type="button"
                            :disabled="locked || item.selectedReference"
                            @click="
                              selectNativeWriting(chapter.id, item, 'reference')
                            "
                          >
                            {{ t("markAsReferenceDraft") }}
                          </button>
                          <button
                            type="button"
                            :disabled="locked || item.important"
                            @click="
                              selectNativeWriting(chapter.id, item, 'important')
                            "
                          >
                            {{ t("markImportantCheckpoint") }}
                          </button>
                        </article>
                      </section>
                    </template>
                  </details>
                  <p v-if="writingPanel(chapter.id).revisionOf">
                    {{
                      t("editingBasedOn", {
                        path: writingPanel(chapter.id).revisionOf?.path ?? "",
                        hash:
                          writingPanel(chapter.id).revisionOf?.hash.slice(
                            0,
                            12
                          ) ?? ""
                      })
                    }}
                  </p>
                  <button
                    v-if="
                      writingPanel(chapter.id).revisionOf?.role ===
                        'candidate' ||
                      writingPanel(chapter.id).revisionOf?.role === 'work'
                    "
                    type="button"
                    :disabled="
                      locked || !writingPanel(chapter.id).pasted.trim()
                    "
                    @click="saveEditedNativeDraft(chapter.id, 'work')"
                  >
                    {{ t("saveAsWorkDraft") }}
                  </button>
                  <button
                    v-if="writingPanel(chapter.id).revisionOf"
                    type="button"
                    :disabled="
                      locked || !writingPanel(chapter.id).pasted.trim()
                    "
                    @click="saveEditedNativeDraft(chapter.id, 'candidate')"
                  >
                    {{ t("saveAsNewCandidate") }}
                  </button>
                </template>
              </template>
            </template>
            <p v-else>{{ t("openToLoadChapterDraftVersions") }}</p>
          </details>
          <form
            v-if="outlineSelectionChapterId === chapter.id"
            class="outline-selection-form"
            @submit.prevent="selectOutline"
          >
            <label>
              {{ t("outlineVersionLabel") }}
              <input
                v-model="outlineSelectionVersion"
                required
                maxlength="256"
              />
            </label>
            <button
              type="submit"
              :disabled="locked || !outlineSelectionVersion.trim()"
            >
              {{ t("saveOutlineSelection") }}
            </button>
            <button type="button" @click="outlineSelectionChapterId = null">
              {{ t("cancelOutlineSelection") }}
            </button>
          </form>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.plot-planning-board {
  min-width: 0;
  padding: 20px;
  overflow: auto;
}
.plot-planning-board h2,
.plot-planning-board h3 {
  margin: 0 0 10px;
  font-size: 1.05rem;
}
.plot-planning-board p {
  color: var(--text-secondary);
  line-height: 1.6;
}
.board-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.board-actions button {
  padding: 6px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  cursor: pointer;
}
.board-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.planning-volume {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--theme-line-soft);
}
.volume-summary {
  white-space: pre-wrap;
}
.volume-summary :deep(.markdown-content) {
  max-height: min(70vh, 900px);
  overflow: auto;
}
.outline-selection-form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px;
  width: 100%;
}
.outline-selection-form label {
  display: grid;
  gap: 4px;
}
.outline-selection-form input {
  min-width: 220px;
  padding: 6px 8px;
}
.planning-volume ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.planning-volume li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 0;
}
.chapter-name {
  flex: 1;
  min-width: 140px;
}
.chapter-status {
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.native-writing-highlights {
  display: grid;
  gap: 8px;
  margin: 8px 0 12px;
}
.native-writing-highlight {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
}
.native-writing-highlight > span {
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.native-writing-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
  margin-top: 8px;
}
.native-writing-panel > summary,
.native-current-body > summary,
.native-writing-history > summary,
.native-writing-item details > summary {
  cursor: pointer;
}
.native-writing-panel > label {
  display: grid;
  gap: 5px;
  min-width: 0;
  color: var(--text-secondary);
  line-height: 1.45;
}
.native-writing-panel input,
.native-writing-panel textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.5;
}
.native-writing-panel textarea {
  resize: vertical;
}
.native-writing-panel > button,
.native-current-body button,
.native-writing-item button,
.native-writing-highlight button {
  justify-self: start;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  cursor: pointer;
}
.native-writing-panel button:disabled {
  opacity: 0.55;
  cursor: default;
}
.native-current-body {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.native-current-body pre {
  box-sizing: border-box;
  max-width: 100%;
  max-height: min(45vh, 480px);
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.native-writing-history,
.native-writing-model-group,
.native-writing-highlights,
.native-writing-highlight,
.native-writing-item {
  min-width: 0;
}
.native-writing-history,
.native-writing-model-group {
  display: grid;
  gap: 8px;
}
.native-writing-history {
  margin-top: 4px;
}
.native-writing-model-group h5,
.native-writing-panel h4 {
  margin: 4px 0 0;
}
.native-writing-item {
  display: grid;
  justify-items: start;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-raised);
}
.native-writing-item > span,
.native-writing-item > small,
.native-writing-highlight > span {
  max-width: 100%;
  overflow-wrap: anywhere;
}
.native-writing-item > span,
.native-writing-item > small {
  color: var(--text-secondary);
}
</style>
