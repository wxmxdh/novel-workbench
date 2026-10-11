import {
  LongLedgerCommitRecordSchema,
  type LongCommitChapterResult,
  type LongTextFilesCommitChapterInput,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { loadIndexedFile } from "./cache";
import {
  applyChapterDecisions,
  collectChapterCommitTargets,
  committedThroughChapterId,
  finishChapterCommit
} from "./commit-chapter-common";
import { assertExactDecisionIds } from "./integrity";
import type { LongProjectStoreContext } from "./store-context";
import type { LoadedLongProject } from "./types";

export async function commitTextFilesChapter(
  ctx: LongProjectStoreContext,
  loaded: LoadedLongProject,
  input: LongTextFilesCommitChapterInput,
  chapterEntry: LongWorkspaceIndexSnapshot["chapters"][number]
): Promise<LongCommitChapterResult> {
  const body = await loadIndexedFile(loaded, chapterEntry.body.id);
  if (!body.disk.content.trim()) {
    throw new Error("提交章节前必须完成章节正文。");
  }
  const targets = collectChapterCommitTargets(
    loaded.index,
    input.chapterCardId
  );
  assertExactDecisionIds(
    "伏笔触点",
    targets.beats.map(({ id }) => id),
    Object.keys(input.foreshadowingBeatDecisions)
  );
  const continuityReferences = [
    chapterEntry.characterState,
    chapterEntry.handoff,
    ...(targets.beats.length > 0 ? [chapterEntry.foreshadowingChanges] : []),
    ...(chapterEntry.worldReveals ? [chapterEntry.worldReveals] : []),
    ...chapterEntry.characterContinuity.flatMap((entry) => [
      entry.currentState,
      entry.history
    ])
  ];
  const continuityFiles = await Promise.all(
    continuityReferences.map(
      async (reference) => await loadIndexedFile(loaded, reference.id)
    )
  );
  for (const file of continuityFiles) {
    if (!file.disk.content.trim()) {
      throw new Error(`连续性文件尚未写入内容：${file.reference.path}`);
    }
  }

  const commitId = createId("commit");
  const timestamp = ctx.timestamp();
  const semanticChanges = applyChapterDecisions({
    index: loaded.index,
    targets,
    commitId,
    placementDecisions: null,
    beatDecisions: input.foreshadowingBeatDecisions
  });
  const record = LongLedgerCommitRecordSchema.parse({
    schemaVersion: 4,
    id: commitId,
    bookId: loaded.manifest.id,
    sequence: (loaded.index.ledger.commits.at(-1)?.sequence ?? 0) + 1,
    chapterCardId: input.chapterCardId,
    committedAt: timestamp,
    commitMessage: input.commitMessage,
    committedThroughChapterId: committedThroughChapterId(
      loaded.index,
      input.chapterCardId
    ),
    ...semanticChanges,
    continuityFiles: continuityFiles.map((file) => ({
      fileId: file.reference.id,
      path: file.reference.path
    }))
  });
  return await finishChapterCommit({
    ctx,
    loaded,
    chapterEntries: [chapterEntry],
    record,
    mode: "text_files"
  });
}
