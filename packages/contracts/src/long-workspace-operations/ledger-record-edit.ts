import type { LongLedgerCommitIndexEntry } from "../long-workspace";
import type { LongWorkspaceLedgerRecordEdit } from "./ledger-impact-schema";

export function createEmptyLedgerRecordEdit(
  commit: LongLedgerCommitIndexEntry
): LongWorkspaceLedgerRecordEdit {
  return {
    commitId: commit.id,
    recordFile: structuredClone(commit.recordFile),
    removePlacementIds: [],
    removeForeshadowingBeatIds: [],
    reconcileForeshadowingThreadIds: [],
    removeSubjectIds: [],
    removeKnowledgeAudienceIds: [],
    removeFactIds: [],
    removeFactKeys: [],
    removeKnowledgeKeys: [],
    removeOpenLoopIds: []
  };
}
