import { z } from "zod";

import {
  longLedgerCommitChapterIds,
  type LongLedgerCommitIndexEntry
} from "./ledger-index-entry";
import { addIssue } from "./index-validation-helpers";

export function indexLedgerCommitMemberships(
  commits: readonly LongLedgerCommitIndexEntry[],
  existingChapterIds: readonly string[],
  context: z.core.$RefinementCtx<unknown>
): Map<string, LongLedgerCommitIndexEntry> {
  const commitByChapterId = new Map<string, LongLedgerCommitIndexEntry>();
  const chapterIds = new Set(existingChapterIds);

  commits.forEach((commit, commitIndex) => {
    const memberIds = longLedgerCommitChapterIds(commit);
    memberIds.forEach((chapterCardId, memberIndex) => {
      const path = [
        "ledger",
        "commits",
        commitIndex,
        commit.mode === "text_files_batch" ? "chapterCardIds" : "chapterCardId",
        ...(commit.mode === "text_files_batch" ? [memberIndex] : [])
      ];
      if (!chapterIds.has(chapterCardId)) {
        addIssue(
          context,
          path,
          "Ledger commit must reference an existing chapter card."
        );
      }
      if (commitByChapterId.has(chapterCardId)) {
        addIssue(
          context,
          path,
          `Duplicate committed chapter: ${chapterCardId}`
        );
      } else {
        commitByChapterId.set(chapterCardId, commit);
      }
    });
  });

  return commitByChapterId;
}
