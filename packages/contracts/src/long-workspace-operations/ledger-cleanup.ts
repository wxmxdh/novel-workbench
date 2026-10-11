import {
  deriveLongForeshadowingStatusFromCommittedBeats,
  longLedgerCommitChapterIds,
  longLedgerCommitContainsChapter,
  type LongForeshadowing,
  type LongForeshadowingBeat,
  type LongLedgerCommitIndexEntry,
  type LongNarrativePlacement
} from "../long-workspace";

import { createEmptyLedgerRecordEdit } from "./ledger-record-edit";
import { cleanupProjectionForDeletedCommit } from "./ledger-semantic-cleanup";
import type { MutationState } from "./state";
import { addFileDeleteIntent, markUpdated, operationError } from "./state";

export { cleanupProjectionForDeletedEntity } from "./ledger-semantic-cleanup";

function ledgerCommit(
  state: MutationState,
  commitId: string
): LongLedgerCommitIndexEntry {
  const commit = state.draft.ledger.commits.find(({ id }) => id === commitId);
  if (!commit) {
    return operationError(
      "invalid_result",
      `Ledger commit ${commitId} does not exist for its recorded decision.`
    );
  }
  return commit;
}

function queueLedgerRecordDecisionRemoval(
  state: MutationState,
  commit: LongLedgerCommitIndexEntry,
  kind: "placement" | "foreshadowing-beat",
  id: string,
  foreshadowingThreadId?: string
): void {
  commit.recordFile.updatedAt = state.updatedAt;
  const current =
    state.ledgerRecordEdits.get(commit.id) ??
    createEmptyLedgerRecordEdit(commit);
  current.recordFile = structuredClone(commit.recordFile);
  const target =
    kind === "placement"
      ? current.removePlacementIds
      : current.removeForeshadowingBeatIds;
  if (!target.includes(id)) target.push(id);
  target.sort();
  if (
    foreshadowingThreadId !== undefined &&
    !current.reconcileForeshadowingThreadIds.includes(foreshadowingThreadId)
  ) {
    current.reconcileForeshadowingThreadIds.push(foreshadowingThreadId);
    current.reconcileForeshadowingThreadIds.sort();
  }
  state.ledgerRecordEdits.set(commit.id, current);
}

export function removePlacementDecisionFromLedger(
  state: MutationState,
  placement: LongNarrativePlacement
): void {
  if (placement.commitId === null) return;
  const commit = ledgerCommit(state, placement.commitId);
  if (!commit.placementIds.includes(placement.id)) {
    operationError(
      "invalid_result",
      `Ledger commit ${commit.id} does not index placement ${placement.id}.`
    );
  }
  commit.placementIds = commit.placementIds.filter((id) => id !== placement.id);
  queueLedgerRecordDecisionRemoval(state, commit, "placement", placement.id);
}

export function removeBeatDecisionFromLedger(
  state: MutationState,
  beat: LongForeshadowingBeat,
  foreshadowingThreadId: string
): void {
  if (beat.commitId === null) return;
  const commit = ledgerCommit(state, beat.commitId);
  if (!commit.foreshadowingBeatIds.includes(beat.id)) {
    operationError(
      "invalid_result",
      `Ledger commit ${commit.id} does not index foreshadowing beat ${beat.id}.`
    );
  }
  commit.foreshadowingBeatIds = commit.foreshadowingBeatIds.filter(
    (id) => id !== beat.id
  );
  queueLedgerRecordDecisionRemoval(
    state,
    commit,
    "foreshadowing-beat",
    beat.id,
    foreshadowingThreadId
  );
}

export function refreshForeshadowingThreadStatus(
  state: MutationState,
  thread: LongForeshadowing
): void {
  if (thread.status === "abandoned") return;
  const nextStatus = deriveLongForeshadowingStatusFromCommittedBeats(
    thread.beats
  );
  if (thread.status === nextStatus) return;
  thread.status = nextStatus;
  markUpdated(state, thread.id);
}

export function removeLedgerCommitForChapter(
  state: MutationState,
  chapterCardId: string
): LongLedgerCommitIndexEntry | null {
  const commit = state.draft.ledger.commits.find((candidate) =>
    longLedgerCommitContainsChapter(candidate, chapterCardId)
  );
  if (!commit) return null;

  addFileDeleteIntent(
    state,
    commit.recordFile,
    `Delete continuity record for chapter ${chapterCardId}`
  );
  state.draft.ledger.commits = state.draft.ledger.commits.filter(
    ({ id }) => id !== commit.id
  );
  state.ledgerRecordEdits.delete(commit.id);

  const memberChapterIds = new Set(longLedgerCommitChapterIds(commit));
  state.draft.chapters.forEach((chapter) => {
    if (!memberChapterIds.has(chapter.chapterCardId)) return;
    chapter.commitId = null;
    markUpdated(state, chapter.chapterCardId);
  });

  state.draft.plot.narrativePlacements.forEach((placement) => {
    if (placement.commitId !== commit.id) return;
    placement.commitId = null;
    placement.status = "planned";
    markUpdated(state, placement.id);
  });
  state.draft.plot.foreshadowing.forEach((thread) => {
    let changed = false;
    thread.beats.forEach((beat) => {
      if (beat.commitId !== commit.id) return;
      beat.commitId = null;
      beat.status = "planned";
      markUpdated(state, beat.id);
      changed = true;
    });
    if (changed) refreshForeshadowingThreadStatus(state, thread);
  });

  cleanupProjectionForDeletedCommit(state, commit.id);
  return commit;
}
