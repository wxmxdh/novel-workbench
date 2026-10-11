<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, ref } from "vue";
import type {
  LongContinuityFileChange,
  LongContinuityFileRole,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { LongProposalLocateTarget } from "../utils/approvalNavigation";
import { buildAgentTextDiff } from "../utils/agentTextDiff";
import AppIcon from "./AppIcon.vue";
import LongLedgerFinalizationCard from "./LongLedgerFinalizationCard.vue";
import LongProposalImpactDetails from "./LongProposalImpactDetails.vue";

const t = createScopedTranslator("components.longProposalReview");

const props = withDefaults(
  defineProps<{
    items: LongWorkspaceProposalItem[];
    workspaceIndex?: LongWorkspaceIndexSnapshot | null;
    embedded?: boolean;
    conversationCard?: boolean;
    compactSummary?: boolean;
  }>(),
  {
    embedded: false,
    conversationCard: false,
    compactSummary: false
  }
);

const emit = defineEmits<{
  approve: [eventId: string];
  reject: [eventId: string];
  retryPreview: [eventId: string];
  locate: [target: LongProposalLocateTarget];
}>();

type CompactFileOperation = {
  id: string;
  eventId: string;
  fileId: string;
  title: string;
  filePath: string;
  version: number;
  status: string;
  diff: ReturnType<typeof buildAgentTextDiff>;
};

type CompactFileGroup = {
  key: string;
  fileId: string;
  title: string;
  filePath: string;
  operations: CompactFileOperation[];
};

const compactFileGroups = computed<CompactFileGroup[]>(() => {
  if (!props.compactSummary) return [];
  const versions = new Map<string, number>();
  const groups = new Map<string, CompactFileGroup>();
  for (const item of props.items) {
    if (!isContentFileProposalItem(item)) continue;
    for (const file of item.event.payload.files) {
      const key = `${item.event.payload.bookId}:${file.fileId}`;
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      const operation: CompactFileOperation = {
        id: `${item.event.id}:${file.fileId}`,
        eventId: item.event.id,
        fileId: file.fileId,
        title: contentFileTitle(item, file),
        filePath: file.filePath,
        version,
        status:
          item.approvalMode === "auto-approve"
            ? t("compactAutoSaved")
            : t("compactSaved"),
        diff: buildAgentTextDiff(file.beforeText, file.afterText)
      };
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          fileId: file.fileId,
          title: operation.title,
          filePath: file.filePath,
          operations: []
        };
        groups.set(key, group);
      }
      group.operations.push(operation);
    }
  }
  return [...groups.values()];
});

const compactSummaryStats = computed(() =>
  compactFileGroups.value.reduce(
    (total, group) => {
      for (const operation of group.operations) {
        total.additions += operation.diff.additions;
        total.deletions += operation.diff.deletions;
      }
      return total;
    },
    { additions: 0, deletions: 0 }
  )
);
const visibleCompactFileGroups = computed(() =>
  showAllCompactFiles.value
    ? compactFileGroups.value
    : compactFileGroups.value.slice(0, 3)
);
const hiddenCompactFileCount = computed(() =>
  Math.max(
    0,
    compactFileGroups.value.length - visibleCompactFileGroups.value.length
  )
);
const compactSummarySavedLabel = computed(() =>
  props.items.every(({ approvalMode }) => approvalMode === "auto-approve")
    ? t("compactAutoSaved")
    : t("compactSaved")
);
const showAllCompactFiles = ref(false);
const openCompactDiffIds = ref(new Set<string>());

function updateCompactDiffOpen(operationId: string, event: Event): void {
  const isOpen = (event.currentTarget as HTMLDetailsElement).open;
  const next = new Set(openCompactDiffIds.value);
  if (isOpen) next.add(operationId);
  else next.delete(operationId);
  openCompactDiffIds.value = next;
}

const pendingCount = computed(
  () => props.items.filter(({ status }) => status !== "accepted").length
);
const completedCount = computed(
  () => props.items.filter(({ status }) => status === "accepted").length
);

type LongContentFileChange = Extract<
  LongWorkspaceProposalItem["event"],
  {
    type:
      | "long.worldbuilding_file_proposal"
      | "long.character_file_proposal"
      | "long.continuity_file_proposal";
  }
>["payload"]["files"][number];

type LongContentFileProposalItem = LongWorkspaceProposalItem & {
  event: Extract<
    LongWorkspaceProposalItem["event"],
    {
      type:
        | "long.worldbuilding_file_proposal"
        | "long.character_file_proposal"
        | "long.continuity_file_proposal";
    }
  >;
};

function isContentFileProposalItem(
  item: LongWorkspaceProposalItem
): item is LongContentFileProposalItem {
  return (
    item.event.type === "long.worldbuilding_file_proposal" ||
    item.event.type === "long.character_file_proposal" ||
    item.event.type === "long.continuity_file_proposal"
  );
}

const hasEditProposalSurfaceItems = computed(() =>
  props.items.some(
    (item) =>
      item.event.type === "long.mutation_proposal" ||
      isContentFileProposalItem(item)
  )
);

const contentFileCards = computed(() => {
  const cards = new Map<
    string,
    Array<{
      file: LongContentFileChange;
      diff: ReturnType<typeof buildAgentTextDiff>;
    }>
  >();
  for (const item of props.items) {
    if (
      item.event.type !== "long.worldbuilding_file_proposal" &&
      item.event.type !== "long.character_file_proposal" &&
      item.event.type !== "long.continuity_file_proposal"
    )
      continue;
    cards.set(
      item.event.id,
      item.event.payload.files.map((file) => ({
        file,
        diff: buildAgentTextDiff(file.beforeText, file.afterText)
      }))
    );
  }
  return cards;
});

const continuityRoleLabels: Record<LongContinuityFileRole, string> = {
  get foreshadowing_changes() {
    return t("foreshadowingChanges");
  },
  get world_reveals() {
    return t("worldbuildingReveals");
  },
  get character_current_state() {
    return t("currentCharacterState");
  },
  get character_history() {
    return t("characterHistory");
  },
  get chapter_end_state() {
    return t("endOfChapterState");
  },
  get handoff() {
    return t("handoffPackage");
  }
};

function trustedContinuityIdentity(fileId: string): {
  chapterCardId: string;
  role: LongContinuityFileRole;
  characterId: string | null;
} | null {
  const index = props.workspaceIndex;
  if (!index) return null;
  for (const chapter of index.chapters) {
    if (chapter.characterState.id === fileId) {
      return {
        chapterCardId: chapter.chapterCardId,
        role: "chapter_end_state",
        characterId: null
      };
    }
    if (chapter.handoff.id === fileId) {
      return {
        chapterCardId: chapter.chapterCardId,
        role: "handoff",
        characterId: null
      };
    }
    if (chapter.foreshadowingChanges.id === fileId) {
      return {
        chapterCardId: chapter.chapterCardId,
        role: "foreshadowing_changes",
        characterId: null
      };
    }
    if (chapter.worldReveals?.id === fileId) {
      return {
        chapterCardId: chapter.chapterCardId,
        role: "world_reveals",
        characterId: null
      };
    }
    for (const continuity of chapter.characterContinuity) {
      if (continuity.currentState.id === fileId) {
        return {
          chapterCardId: chapter.chapterCardId,
          role: "character_current_state",
          characterId: continuity.characterId
        };
      }
      if (continuity.history.id === fileId) {
        return {
          chapterCardId: chapter.chapterCardId,
          role: "character_history",
          characterId: continuity.characterId
        };
      }
    }
  }
  return null;
}

function continuityFileTitle(
  item: LongWorkspaceProposalItem,
  file: LongContinuityFileChange
): string {
  const index = props.workspaceIndex;
  const identity = trustedContinuityIdentity(file.fileId);
  const trusted =
    identity ??
    (item.preview
      ? {
          chapterCardId: file.chapterCardId,
          role: file.role,
          characterId: file.characterId
        }
      : null);
  if (!index || !trusted) return t("continuityFilesPendingValidation");
  const chapter = index.plot.chapterCards.find(
    ({ id }) => id === trusted.chapterCardId
  );
  const character =
    trusted.characterId === null
      ? null
      : index.characters.find(({ id }) => id === trusted.characterId);
  if (!chapter || (trusted.characterId !== null && !character)) {
    return t("continuityFilesPendingValidation");
  }
  return `${chapter.title} / ${
    character ? `${character.name} / ` : ""
  }${continuityRoleLabels[trusted.role]}`;
}

function contentFileTitle(
  item: LongWorkspaceProposalItem,
  file: LongContentFileChange
): string {
  return item.event.type === "long.continuity_file_proposal"
    ? continuityFileTitle(item, file as LongContinuityFileChange)
    : file.title;
}

function canDisplayContentFileDiff(item: LongWorkspaceProposalItem): boolean {
  return (
    item.event.type !== "long.continuity_file_proposal" ||
    (Boolean(item.preview) &&
      (item.status === "ready" ||
        item.status === "submitting" ||
        item.status === "accepted"))
  );
}

function proposalTitle(item: LongWorkspaceProposalItem): string {
  switch (item.event.type) {
    case "long.mutation_proposal":
      return t("structureChanges");
    case "long.worldbuilding_file_proposal":
      return item.event.payload.files.length === 1
        ? item.event.payload.files[0]!.title
        : t("valueWorldbuildingFiles", {
            arg0: item.event.payload.files.length
          });
    case "long.character_file_proposal":
      return item.event.payload.files.length === 1
        ? item.event.payload.files[0]!.title
        : t("valueFilesForValue", {
            arg0: item.event.payload.files[0]?.characterName ?? t("characters"),
            arg1: item.event.payload.files.length
          });
    case "long.continuity_file_proposal":
      return item.event.payload.files.length === 1
        ? contentFileTitle(item, item.event.payload.files[0]!)
        : t("valueContinuityFiles", {
            arg0: item.event.payload.files.length
          });
    case "long.ledger_commit_proposal":
      return t("continuityLedgerArchive");
  }
}

function proposalAction(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return t("processing");
  if (item.approvalMode === "auto-approve" && item.status === "error") {
    return t("retryAutosave");
  }
  if (item.status === "error" && item.event.type !== "long.mutation_proposal") {
    return t("retry");
  }
  switch (item.event.type) {
    case "long.mutation_proposal":
      return t("apply");
    case "long.worldbuilding_file_proposal":
    case "long.character_file_proposal":
    case "long.continuity_file_proposal":
      return t("writeAndSave");
    case "long.ledger_commit_proposal":
      return item.status === "error" ? t("retryArchive") : t("archiveNow");
  }
}

function proposalStatusText(item: LongWorkspaceProposalItem): string {
  if (item.event.type === "long.ledger_commit_proposal") {
    if (item.status === "accepted") return t("archived");
    if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
    if (item.status === "submitting") return t("archiving");
    if (item.status === "error") return t("archiveFailed");
    return t("awaitingArchive");
  }
  if (item.status === "accepted") return t("accepted");
  if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
  if (item.status === "previewing") {
    return item.approvalMode === "auto-approve"
      ? t("automaticPreview")
      : t("previewing");
  }
  if (item.status === "submitting") {
    return item.approvalMode === "auto-approve"
      ? t("autosaving")
      : t("processingLabel");
  }
  if (item.status === "error") {
    if (item.errorPhase === "preview") return t("validationFailed");
    return item.approvalMode === "auto-approve"
      ? t("autosaveFailed")
      : item.errorRetryable === false
        ? t("cannotApply")
        : t("failedToApply");
  }
  return item.approvalMode === "auto-approve"
    ? t("awaitingAutosave")
    : t("awaitingConfirmation");
}

function contentProposalVisualStatus(
  item: LongWorkspaceProposalItem
): "pending" | "accepting" | "accepted" | "error" {
  if (item.status === "accepted") return "accepted";
  if (item.status === "error") return "error";
  if (item.status === "previewing" || item.status === "submitting") {
    return "accepting";
  }
  return "pending";
}

function contentProposalStatusLabel(item: LongWorkspaceProposalItem): string {
  if (item.status === "accepted") return t("accepted");
  if (item.status === "error") {
    return item.errorPhase === "preview"
      ? t("validationFailed")
      : t("failedToApply");
  }
  if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
  if (item.status === "previewing") return t("validating");
  if (item.status === "submitting") return t("applying");
  return item.approvalMode === "auto-approve"
    ? t("awaitingAutosaveLabel")
    : t("awaitingReview");
}

function contentProposalDiffStats(item: LongWorkspaceProposalItem): {
  additions: number;
  deletions: number;
  hunks: number;
} {
  return (contentFileCards.value.get(item.event.id) ?? []).reduce(
    (total, card) => ({
      additions: total.additions + card.diff.additions,
      deletions: total.deletions + card.diff.deletions,
      hunks: total.hunks + card.diff.hunks.length
    }),
    { additions: 0, deletions: 0, hunks: 0 }
  );
}

function contentProposalStatusMessage(item: LongWorkspaceProposalItem): string {
  if (item.status === "accepted") {
    return item.approvalMode === "auto-approve"
      ? t("automaticallyApprovedAndSavedToLocalMarkdown")
      : t("changesAppliedAndSavedLocally");
  }
  if (item.status === "error") {
    if (item.errorPhase === "preview") {
      return item.error ?? t("couldNotReadTheChangeImpactContentHasNot");
    }
    return item.error ?? t("changesCouldNotBeSavedSaveAgainOrReject");
  }
  if (item.status === "waiting") {
    return t("waitingForPrecedingFileOperationsToFinishBeforeResuming");
  }
  if (item.status === "previewing") {
    return t("readingFilesAndChangeImpact");
  }
  if (item.status === "submitting") {
    return t("applyingAndSavingChanges");
  }
  return item.approvalMode === "auto-approve"
    ? t("addedToTheAutosaveQueue")
    : t("acceptToApplyToTheCorrespondingMarkdownFilesAnd");
}

function showContentProposalActions(item: LongWorkspaceProposalItem): boolean {
  return (
    item.status !== "accepted" &&
    (item.approvalMode !== "auto-approve" || item.status === "error")
  );
}

function contentProposalAcceptDisabled(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    item.status === "previewing" ||
    item.status === "submitting" ||
    item.status === "waiting" ||
    (item.status === "error" && item.errorRetryable === false) ||
    (item.status === "ready" && !item.preview)
  );
}

function contentProposalAcceptLabel(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return t("saving");
  if (item.status === "error" && item.errorRetryable === false) {
    return t("cannotSave");
  }
  return item.status === "error"
    ? item.errorPhase === "preview"
      ? t("reloadAndSave")
      : t("saveAgain")
    : t("acceptAndSave");
}

function isStructureProposalItem(item: LongWorkspaceProposalItem): boolean {
  return item.event.type === "long.mutation_proposal";
}

function usesEditProposalSurface(item: LongWorkspaceProposalItem): boolean {
  return isStructureProposalItem(item) || isContentFileProposalItem(item);
}

function proposalVisualStatus(
  item: LongWorkspaceProposalItem
): "pending" | "accepting" | "accepted" | "rejected" | "conflict" | "error" {
  return contentProposalVisualStatus(item);
}

function structureProposalStatusMessage(
  item: LongWorkspaceProposalItem
): string {
  if (item.status === "accepted")
    return t("structureChangesAppliedAndSavedLocally");
  if (item.status === "error") {
    if (item.errorPhase === "preview") {
      return item.error ?? t("couldNotReadStructuralImpactChangesHaveNotBeen");
    }
    return item.error ?? t("structureChangesCouldNotBeAppliedPreviewAgainTo");
  }
  if (item.status === "previewing") {
    return t("readingCurrentStructureAndImpact");
  }
  if (item.status === "submitting") {
    return t("applyingStructureChanges");
  }
  return item.approvalMode === "auto-approve"
    ? t("addedToTheAutosaveQueue")
    : t("acceptToApplyToThisBookSStructureAnd");
}

function structureProposalAcceptDisabled(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    item.status === "previewing" ||
    item.status === "submitting" ||
    item.status === "waiting" ||
    (item.status === "error" && item.errorRetryable === false) ||
    (item.status === "ready" && !item.preview)
  );
}

function structureProposalAcceptLabel(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return t("applyingLabel");
  if (item.status === "error" && item.errorRetryable === false) {
    return t("cannotApply");
  }
  return item.status === "error"
    ? item.errorPhase === "preview"
      ? t("revalidateAndApply")
      : t("retryApplying")
    : t("acceptAndApply");
}

function diffLineMark(type: "context" | "addition" | "deletion"): string {
  if (type === "addition") return "+";
  if (type === "deletion") return "−";
  return " ";
}
</script>

<template>
  <section
    v-if="items.length"
    class="long-proposal-review"
    :class="{
      'is-embedded': embedded,
      'is-conversation-card': conversationCard,
      'has-edit-proposal-surface-items': hasEditProposalSurfaceItems
    }"
    :aria-label="t('novelProposalsAwaitingApproval')"
  >
    <header v-if="!embedded">
      <div>
        <span>{{ t("agentWrites") }}</span>
        <strong v-if="pendingCount">{{
          t("processingMessage", {
            arg0: pendingCount ?? ""
          })
        }}</strong>
        <strong v-else>{{
          t("savedMessage", {
            arg0: completedCount ?? ""
          })
        }}</strong>
      </div>
      <small>{{ t("allChangesAreScopedToTheCurrentBook") }}</small>
    </header>

    <section
      v-if="compactSummary"
      class="long-proposal-compact-summary"
      :aria-label="t('modifiedFiles', { arg0: compactFileGroups.length })"
    >
      <header class="compact-summary-heading">
        <strong>{{
          t("modifiedFiles", { arg0: compactFileGroups.length })
        }}</strong>
        <span class="compact-summary-stats">
          <span class="is-addition">+{{ compactSummaryStats.additions }}</span>
          <span class="is-deletion">−{{ compactSummaryStats.deletions }}</span>
        </span>
        <small>{{ compactSummarySavedLabel }}</small>
      </header>
      <div class="compact-summary-files">
        <section
          v-for="group in visibleCompactFileGroups"
          :key="group.key"
          class="compact-summary-file"
        >
          <div class="compact-summary-file-heading">
            <button
              class="compact-summary-file-title"
              type="button"
              @click.stop="
                emit('locate', {
                  eventId:
                    group.operations[group.operations.length - 1]!.eventId,
                  fileId: group.fileId
                })
              "
            >
              {{ group.title }}
            </button>
            <details class="compact-summary-path">
              <summary>{{ t("showPath") }}</summary>
              <code>{{ group.filePath }}</code>
            </details>
          </div>
          <div
            v-for="operation in group.operations"
            :key="operation.id"
            class="compact-summary-operation"
          >
            <span class="compact-summary-operation-status">
              {{ operation.status }} ·
              {{ t("editVersion", { arg0: operation.version }) }}
            </span>
            <span
              class="compact-summary-stats"
              :aria-label="
                t('valueLinesAddedValueLinesRemoved', {
                  arg0: operation.diff.additions,
                  arg1: operation.diff.deletions
                })
              "
            >
              <span class="is-addition">+{{ operation.diff.additions }}</span>
              <span class="is-deletion">−{{ operation.diff.deletions }}</span>
            </span>
            <details
              class="edit-proposal-diff compact-summary-diff"
              @toggle="updateCompactDiffOpen(operation.id, $event)"
            >
              <summary>
                <span>{{ t("viewChanges") }}</span>
                <AppIcon name="chevron" :size="13" />
              </summary>
              <div
                v-if="openCompactDiffIds.has(operation.id)"
                class="edit-diff-content"
              >
                <div
                  v-for="(hunk, hunkIndex) in operation.diff.hunks"
                  :key="`${operation.id}:hunk:${hunkIndex}`"
                  class="edit-diff-hunk"
                >
                  <div class="edit-diff-hunk-header">
                    @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{
                      hunk.newStart
                    }},{{ hunk.newLines }} @@
                  </div>
                  <div
                    v-for="(line, lineIndex) in hunk.lines"
                    :key="`${operation.id}:${hunkIndex}:${lineIndex}`"
                    class="edit-diff-line"
                    :class="`is-${line.type}`"
                  >
                    <span class="edit-diff-line-number">
                      {{ line.oldLineNumber ?? "" }}
                    </span>
                    <span class="edit-diff-line-number">
                      {{ line.newLineNumber ?? "" }}
                    </span>
                    <span class="edit-diff-line-mark" aria-hidden="true">
                      {{ diffLineMark(line.type) }}
                    </span>
                    <code>{{ line.text }}</code>
                  </div>
                </div>
                <p v-if="operation.diff.truncated" class="edit-diff-truncated">
                  {{ t("thisDiffIsLargeSoOnlySomeChangesAre") }}
                </p>
                <p
                  v-if="!operation.diff.hunks.length"
                  class="edit-proposal-empty"
                >
                  {{ t("noTextLineChanges") }}
                </p>
              </div>
            </details>
          </div>
        </section>
      </div>
      <button
        v-if="hiddenCompactFileCount"
        class="compact-summary-more"
        type="button"
        @click="showAllCompactFiles = true"
      >
        {{ t("showMoreFiles", { arg0: hiddenCompactFileCount }) }}
      </button>
      <button
        v-else-if="showAllCompactFiles && compactFileGroups.length > 3"
        class="compact-summary-more"
        type="button"
        @click="showAllCompactFiles = false"
      >
        {{ t("showFewerFiles") }}
      </button>
    </section>

    <div v-else class="long-proposal-list">
      <article
        v-for="item in items"
        :key="item.event.id"
        :class="
          item.event.type === 'long.ledger_commit_proposal'
            ? 'long-ledger-finalization-item'
            : usesEditProposalSurface(item)
              ? ['edit-proposal-card', `is-${proposalVisualStatus(item)}`]
              : 'long-proposal-card'
        "
        :data-proposal-type="item.event.type"
        :aria-busy="item.status === 'submitting'"
      >
        <LongLedgerFinalizationCard
          v-if="item.event.type === 'long.ledger_commit_proposal'"
          :item="item"
          @approve="emit('approve', item.event.id)"
          @reject="emit('reject', item.event.id)"
        />
        <div
          v-if="
            item.event.type !== 'long.ledger_commit_proposal' &&
            !usesEditProposalSurface(item)
          "
          class="long-proposal-heading"
        >
          <span class="long-proposal-icon">
            <AppIcon
              :name="
                item.event.type === 'long.worldbuilding_file_proposal' ||
                item.event.type === 'long.character_file_proposal' ||
                item.event.type === 'long.continuity_file_proposal'
                  ? 'file'
                  : 'wand'
              "
              :size="15"
            />
          </span>
          <div>
            <strong>{{ proposalTitle(item) }}</strong>
            <small>{{ item.event.payload.agentId }}</small>
          </div>
          <div class="approval-status-actions">
            <span class="long-proposal-status" :class="`is-${item.status}`">
              {{ proposalStatusText(item) }}
            </span>
            <button
              v-if="item.status === 'accepted'"
              class="approval-target-button"
              type="button"
              :title="t('goToTargetFile')"
              :aria-label="t('goToTargetFile')"
              @click.stop="emit('locate', { eventId: item.event.id })"
            >
              {{ t("goToTargetFile") }}
            </button>
          </div>
        </div>

        <p
          v-if="
            item.event.type !== 'long.ledger_commit_proposal' &&
            !usesEditProposalSurface(item)
          "
        >
          {{ item.event.payload.summary }}
        </p>

        <template v-if="usesEditProposalSurface(item)">
          <header class="edit-proposal-header">
            <span class="edit-proposal-icon" aria-hidden="true">
              <AppIcon
                :name="isStructureProposalItem(item) ? 'wand' : 'file'"
                :size="17"
              />
            </span>
            <div class="edit-proposal-heading">
              <div class="edit-proposal-title-row">
                <strong>{{ proposalTitle(item) }}</strong>
                <span
                  class="edit-proposal-status"
                  :class="`is-${proposalVisualStatus(item)}`"
                >
                  {{
                    isStructureProposalItem(item)
                      ? proposalStatusText(item)
                      : contentProposalStatusLabel(item)
                  }}
                </span>
                <button
                  v-if="item.status === 'accepted'"
                  class="approval-target-button"
                  type="button"
                  :title="t('goToTargetFile')"
                  :aria-label="t('goToTargetFile')"
                  @click.stop="emit('locate', { eventId: item.event.id })"
                >
                  {{ t("goToTargetFile") }}
                </button>
              </div>
              <p>{{ item.event.payload.summary }}</p>
            </div>
            <div
              v-if="
                isContentFileProposalItem(item) &&
                canDisplayContentFileDiff(item)
              "
              class="edit-proposal-stats"
              :aria-label="
                t('valueLinesAddedValueLinesRemoved', {
                  arg0: contentProposalDiffStats(item).additions,
                  arg1: contentProposalDiffStats(item).deletions
                })
              "
            >
              <span class="is-addition">
                +{{ contentProposalDiffStats(item).additions }}
              </span>
              <span class="is-deletion">
                −{{ contentProposalDiffStats(item).deletions }}
              </span>
            </div>
          </header>

          <details
            v-if="
              isContentFileProposalItem(item) &&
              canDisplayContentFileDiff(item) &&
              contentProposalDiffStats(item).hunks
            "
            class="edit-proposal-diff"
          >
            <summary>
              <span>{{ t("viewChanges") }}</span>
              <small>
                {{
                  t("changeBlocksMessage", {
                    arg0: contentProposalDiffStats(item).hunks ?? ""
                  })
                }}
              </small>
              <AppIcon name="chevron" :size="13" />
            </summary>
            <div class="edit-diff-content">
              <section
                v-for="card in contentFileCards.get(item.event.id) ?? []"
                :key="card.file.fileId"
                class="long-edit-diff-file"
              >
                <div
                  v-if="(contentFileCards.get(item.event.id)?.length ?? 0) > 1"
                  class="long-edit-diff-file-label"
                >
                  {{ contentFileTitle(item, card.file) }}
                </div>
                <div
                  v-for="(hunk, hunkIndex) in card.diff.hunks"
                  :key="`${card.file.fileId}:hunk:${hunkIndex}`"
                  class="edit-diff-hunk"
                >
                  <div class="edit-diff-hunk-header">
                    @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{
                      hunk.newStart
                    }},{{ hunk.newLines }}
                    @@
                  </div>
                  <div
                    v-for="(line, lineIndex) in hunk.lines"
                    :key="`${card.file.fileId}:${hunkIndex}:${lineIndex}`"
                    class="edit-diff-line"
                    :class="`is-${line.type}`"
                  >
                    <span class="edit-diff-line-number">
                      {{ line.oldLineNumber ?? "" }}
                    </span>
                    <span class="edit-diff-line-number">
                      {{ line.newLineNumber ?? "" }}
                    </span>
                    <span class="edit-diff-line-mark" aria-hidden="true">
                      {{ diffLineMark(line.type) }}
                    </span>
                    <code>{{ line.text }}</code>
                  </div>
                </div>
                <p v-if="card.diff.truncated" class="edit-diff-truncated">
                  {{ t("thisDiffIsLargeSoOnlySomeChangesAre") }}
                </p>
              </section>
            </div>
          </details>
          <p
            v-else-if="
              isContentFileProposalItem(item) &&
              !canDisplayContentFileDiff(item)
            "
            class="edit-proposal-empty"
          >
            {{ t("fileIdentityAndSourceContentHaveNotPassedValidation") }}
          </p>
          <p
            v-else-if="isContentFileProposalItem(item)"
            class="edit-proposal-empty"
          >
            {{ t("aBlankMarkdownFileWasCreatedNoManuscriptLine") }}
          </p>

          <footer class="edit-proposal-footer">
            <span class="edit-proposal-message">
              {{
                isStructureProposalItem(item)
                  ? structureProposalStatusMessage(item)
                  : contentProposalStatusMessage(item)
              }}
            </span>
            <div
              v-if="
                isStructureProposalItem(item)
                  ? item.status !== 'accepted' &&
                    (item.approvalMode !== 'auto-approve' ||
                      item.status === 'error')
                  : showContentProposalActions(item)
              "
              class="edit-proposal-actions"
            >
              <button
                class="edit-review-button is-reject"
                type="button"
                :disabled="item.status === 'submitting'"
                @click="emit('reject', item.event.id)"
              >
                {{ t("reject") }}
              </button>
              <button
                class="edit-review-button is-accept"
                type="button"
                :disabled="
                  isStructureProposalItem(item)
                    ? structureProposalAcceptDisabled(item)
                    : contentProposalAcceptDisabled(item)
                "
                @click="emit('approve', item.event.id)"
              >
                {{
                  isStructureProposalItem(item)
                    ? structureProposalAcceptLabel(item)
                    : contentProposalAcceptLabel(item)
                }}
              </button>
            </div>
          </footer>
        </template>

        <LongProposalImpactDetails
          v-if="item.event.type === 'long.mutation_proposal' && item.preview"
          :item="item"
          :workspace-index="workspaceIndex"
        />

        <footer
          v-if="
            item.event.type !== 'long.ledger_commit_proposal' &&
            !usesEditProposalSurface(item) &&
            item.status !== 'accepted' &&
            (item.approvalMode !== 'auto-approve' || item.status === 'error')
          "
        >
          <button
            class="long-proposal-secondary"
            type="button"
            :disabled="item.status === 'submitting'"
            @click="emit('reject', item.event.id)"
          >
            {{ t("reject") }}
          </button>
          <button
            v-if="
              (item.event.type === 'long.mutation_proposal' ||
                item.event.type === 'long.worldbuilding_file_proposal' ||
                item.event.type === 'long.character_file_proposal' ||
                item.event.type === 'long.continuity_file_proposal') &&
              item.status === 'error'
            "
            class="long-proposal-secondary"
            type="button"
            @click="emit('retryPreview', item.event.id)"
          >
            {{ t("previewAgain") }}
          </button>
          <button
            class="long-proposal-primary"
            type="button"
            :disabled="
              item.status === 'previewing' ||
              item.status === 'submitting' ||
              ((item.event.type === 'long.mutation_proposal' ||
                item.event.type === 'long.worldbuilding_file_proposal' ||
                item.event.type === 'long.character_file_proposal' ||
                item.event.type === 'long.continuity_file_proposal') &&
                (item.status !== 'ready' || !item.preview))
            "
            @click="emit('approve', item.event.id)"
          >
            {{ proposalAction(item) }}
          </button>
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.long-proposal-review {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: min(43%, 360px);
  min-height: 0;
  border-top: 1px solid var(--theme-line);
  background: var(--surface-muted);
  color: var(--text-primary);
}

.long-proposal-review.is-embedded {
  max-height: none;
  border-top: 0;
  background: transparent;
}

.long-proposal-review.is-embedded .long-proposal-list {
  padding: 10px 0 0;
  overflow: visible;
}

.long-proposal-review.is-embedded.has-edit-proposal-surface-items
  .long-proposal-list {
  gap: 12px;
  padding: 0;
  margin: 14px 0 20px;
}

.long-proposal-review.is-embedded.is-conversation-card .long-proposal-list {
  padding: 0;
  margin: 0;
}

.long-proposal-compact-summary {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
}

.compact-summary-heading,
.compact-summary-file-heading,
.compact-summary-operation {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.compact-summary-heading strong {
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 650;
}

.compact-summary-heading small,
.compact-summary-operation-status {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.compact-summary-stats {
  display: inline-flex;
  gap: 5px;
  font-size: 0.678571rem;
  font-variant-numeric: tabular-nums;
}

.compact-summary-stats .is-addition {
  color: var(--success);
}

.compact-summary-stats .is-deletion {
  color: var(--danger);
}

.compact-summary-files {
  display: grid;
  gap: 4px;
}

.compact-summary-file {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 6px 0;
  border-top: 1px solid var(--theme-line-soft);
}

.compact-summary-file-heading {
  justify-content: space-between;
}

.compact-summary-file-title {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.714286rem;
  font-weight: 600;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.compact-summary-file-title:hover {
  color: var(--accent);
  text-decoration: underline;
}

.compact-summary-path,
.compact-summary-diff {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.compact-summary-path summary,
.compact-summary-diff summary {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  list-style: none;
}

.compact-summary-path summary::-webkit-details-marker,
.compact-summary-diff summary::-webkit-details-marker {
  display: none;
}

.compact-summary-path code {
  display: block;
  max-width: min(52vw, 520px);
  margin-top: 4px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.compact-summary-operation {
  flex-wrap: wrap;
  padding-left: 8px;
}

.compact-summary-operation-status {
  flex: 1 1 auto;
}

.compact-summary-diff {
  flex-basis: 100%;
  padding-left: 8px;
}

.compact-summary-diff[open] > summary svg {
  transform: rotate(180deg);
}

.compact-summary-more {
  justify-self: start;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 0.678571rem;
  cursor: pointer;
}

.long-proposal-review > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-proposal-review > header > div {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.long-proposal-review > header span,
.long-proposal-review > header small {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-proposal-review > header strong {
  font-size: 0.75rem;
}

.long-proposal-list {
  display: grid;
  gap: 7px;
  min-height: 0;
  padding: 8px;
  overflow: auto;
}

.long-proposal-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
}

.long-proposal-heading {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.long-proposal-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
}

.long-proposal-heading > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.long-proposal-heading strong {
  font-size: 0.75rem;
}

.long-proposal-heading small {
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}

.long-proposal-status {
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--surface-selected);
  color: var(--text-secondary);
  font-size: 0.607143rem;
}

.long-proposal-status.is-error {
  color: var(--danger);
}

.long-proposal-status.is-accepted {
  background: color-mix(in srgb, var(--success) 13%, transparent);
  color: var(--success);
}

.long-proposal-card > p {
  color: var(--text-secondary);
  font-size: 0.678571rem;
  line-height: 1.55;
}

.long-edit-diff-file + .long-edit-diff-file {
  border-top: 1px solid var(--theme-line-soft);
}

.long-edit-diff-file-label {
  padding: 6px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.long-proposal-card footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.long-proposal-card button {
  min-height: 27px;
  padding: 4px 9px;
  border-radius: 7px;
  font-size: 0.678571rem;
  cursor: pointer;
}

.long-proposal-card button:disabled {
  cursor: default;
  opacity: 0.55;
}

.long-proposal-secondary {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.long-proposal-secondary:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-proposal-primary {
  background: var(--neutral-solid);
  color: var(--accent-contrast, #fff);
}

:global(html[data-theme="dark"] .long-proposal-primary) {
  background: var(--accent);
}
</style>
