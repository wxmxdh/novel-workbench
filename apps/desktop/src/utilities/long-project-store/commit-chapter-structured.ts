import {
  LongLedgerCommitRecordSchema,
  type LongCommitChapterResult,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { loadIndexedFile } from "./cache";
import {
  applyChapterDecisions,
  collectChapterCommitTargets,
  committedThroughChapterId,
  finishChapterCommit
} from "./commit-chapter-common";
import {
  appendLongCharacterHistoryEntry,
  assertLongContinuityMutationAuthority,
  materializeLongContinuityProjection,
  serializeLongContinuityHandoff
} from "./continuity";
import { assertExactDecisionIds } from "./integrity";
import { encodeUtf8Strict } from "./io";
import type { LongProjectStoreContext } from "./store-context";
import {
  MAX_DOCUMENT_BYTES,
  type LoadedIndexedFile,
  type LoadedLongProject,
  type LongStructuredCommitChapterInput
} from "./types";

export async function commitStructuredChapter(
  ctx: LongProjectStoreContext,
  loaded: LoadedLongProject,
  input: LongStructuredCommitChapterInput,
  chapterEntry: LongWorkspaceIndexSnapshot["chapters"][number]
): Promise<LongCommitChapterResult> {
  const chapterFiles = await Promise.all(
    [chapterEntry.body, chapterEntry.characterState, chapterEntry.handoff].map(
      async (reference) => await loadIndexedFile(loaded, reference.id)
    )
  );
  if (!chapterFiles[0]!.disk.content.trim()) {
    throw new Error("提交章节前必须完成章节正文。");
  }
  const usesTypedContinuity =
    input.factMutations.length > 0 ||
    input.knowledgeMutations.length > 0 ||
    input.openLoopMutations.length > 0 ||
    input.chapterOutputs.characterState.trim().length > 0 ||
    input.chapterOutputs.handoff.summary.trim().length > 0 ||
    Object.values(input.coverage).some(
      ({ status, note }) =>
        status !== "not_applicable" || note.trim().length > 0
    );
  if (
    !usesTypedContinuity &&
    chapterFiles.slice(1).some(({ disk }) => !disk.content.trim())
  ) {
    throw new Error(
      "旧版连续性提交前必须完成正文、角色状态和下一章交接摘要三份文档。"
    );
  }

  const targets = collectChapterCommitTargets(
    loaded.index,
    input.chapterCardId
  );
  assertExactDecisionIds(
    "叙事落点",
    targets.placements.map(({ id }) => id),
    Object.keys(input.placementDecisions)
  );
  assertExactDecisionIds(
    "伏笔节拍",
    targets.beats.map(({ id }) => id),
    Object.keys(input.foreshadowingBeatDecisions)
  );
  assertCommittedBeatsHaveCommittedPlacements(
    loaded.index,
    input,
    targets.beats
  );
  if (usesTypedContinuity) {
    assertLongContinuityMutationAuthority(loaded.index, input);
  }

  const commitId = createId("commit");
  const timestamp = ctx.timestamp();
  const continuityUpdate = usesTypedContinuity
    ? materializeLongContinuityProjection({
        projection: loaded.index.ledger.projection,
        commitId,
        chapterCardId: input.chapterCardId,
        factMutations: input.factMutations,
        knowledgeMutations: input.knowledgeMutations,
        openLoopMutations: input.openLoopMutations,
        handoff: input.chapterOutputs.handoff
      })
    : {
        projection: loaded.index.ledger.projection,
        factChanges: [],
        knowledgeChanges: [],
        openLoopChanges: []
      };
  const semanticChanges = applyChapterDecisions({
    index: loaded.index,
    targets,
    commitId,
    placementDecisions: input.placementDecisions,
    beatDecisions: input.foreshadowingBeatDecisions
  });
  const fileOperations = await buildContinuityFileOperations({
    loaded,
    input,
    chapterEntry,
    chapterFiles,
    commitId,
    timestamp,
    usesTypedContinuity
  });
  loaded.index.ledger.projection = continuityUpdate.projection;
  const record = LongLedgerCommitRecordSchema.parse({
    schemaVersion: usesTypedContinuity ? 3 : 2,
    id: commitId,
    bookId: loaded.manifest.id,
    sequence: (loaded.index.ledger.commits.at(-1)?.sequence ?? 0) + 1,
    chapterCardId: input.chapterCardId,
    committedAt: timestamp,
    commitMessage: input.commitMessage,
    chapterSummary: input.chapterSummary,
    committedThroughChapterId: committedThroughChapterId(
      loaded.index,
      input.chapterCardId
    ),
    ...semanticChanges,
    coverage: input.coverage,
    factChanges: continuityUpdate.factChanges,
    knowledgeChanges: continuityUpdate.knowledgeChanges,
    openLoopChanges: continuityUpdate.openLoopChanges,
    chapterOutputs: input.chapterOutputs
  });
  return await finishChapterCommit({
    ctx,
    loaded,
    chapterEntries: [chapterEntry],
    record,
    mode: "structured",
    fileOperations
  });
}

function assertCommittedBeatsHaveCommittedPlacements(
  index: LongWorkspaceIndexSnapshot,
  input: LongStructuredCommitChapterInput,
  beats: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"][number]["beats"]
): void {
  const placementById = new Map(
    index.plot.narrativePlacements.map((placement) => [placement.id, placement])
  );
  for (const beat of beats) {
    if (
      input.foreshadowingBeatDecisions[beat.id]?.status !== "committed" ||
      beat.placementId === null
    ) {
      continue;
    }
    const placement = placementById.get(beat.placementId);
    if (!placement) {
      throw new Error(`伏笔节拍 ${beat.id} 绑定的叙事落点不存在。`);
    }
    if (input.placementDecisions[placement.id]?.status !== "committed") {
      throw new Error("已提交的伏笔节拍要求其绑定叙事落点也标记为 committed。");
    }
    if (beat.eventId !== placement.eventId) {
      throw new Error("已提交的伏笔节拍与其绑定叙事落点必须引用同一事件。");
    }
  }
}

async function buildContinuityFileOperations(input: {
  loaded: LoadedLongProject;
  input: LongStructuredCommitChapterInput;
  chapterEntry: LongWorkspaceIndexSnapshot["chapters"][number];
  chapterFiles: LoadedIndexedFile[];
  commitId: string;
  timestamp: string;
  usesTypedContinuity: boolean;
}): Promise<ProjectTransactionFileOperation[]> {
  const operations: ProjectTransactionFileOperation[] = [];
  if (input.usesTypedContinuity) {
    const generated = [
      {
        file: input.chapterFiles[1]!,
        content: input.input.chapterOutputs.characterState
      },
      {
        file: input.chapterFiles[2]!,
        content: serializeLongContinuityHandoff(
          input.input.chapterOutputs.handoff
        )
      }
    ];
    for (const output of generated) {
      assertDocumentSize(output.content);
      output.file.reference.updatedAt = input.timestamp;
      operations.push({
        path: output.file.reference.path,
        content: output.content
      });
    }
  }
  const chapterFileIds = new Set(
    input.loaded.index.chapters.flatMap((chapter) => [
      chapter.body.id,
      chapter.card.id,
      chapter.characterState.id,
      chapter.handoff.id,
      chapter.foreshadowingChanges.id,
      ...(chapter.worldReveals ? [chapter.worldReveals.id] : [])
    ])
  );
  const roles = new Map<
    string,
    "relationships" | "current-state" | "history"
  >();
  for (const entry of input.loaded.index.characterFiles) {
    roles.set(entry.relationships.id, "relationships");
  }
  for (const entry of input.chapterEntry.characterContinuity) {
    roles.set(entry.currentState.id, "current-state");
    roles.set(entry.history.id, "history");
  }
  for (const update of input.input.fileUpdates) {
    const file = await loadIndexedFile(input.loaded, update.fileId);
    const role = roles.get(update.fileId);
    if (
      file.kind !== "markdown" ||
      chapterFileIds.has(update.fileId) ||
      !role
    ) {
      throw new Error(
        "连续性提交只能更新人物关系、人物当前状态或追加人物历史。"
      );
    }
    if (
      (role === "history" && update.mode !== "append") ||
      (role !== "history" && update.mode !== "replace")
    ) {
      throw new Error(
        role === "history"
          ? "人物历史只能由连续性账本追加，不能整体替换。"
          : "人物关系和当前状态必须提交完整替换内容。"
      );
    }
    if (!update.content.trim()) {
      throw new Error("连续性资料更新不能是空内容。");
    }
    const content =
      role === "history"
        ? appendLongCharacterHistoryEntry(file.disk.content, {
            chapterCardId: input.input.chapterCardId,
            commitId: input.commitId,
            committedAt: input.timestamp,
            content: update.content
          })
        : update.content;
    assertDocumentSize(content);
    file.reference.updatedAt = input.timestamp;
    operations.push({ path: file.reference.path, content });
  }
  return operations;
}

function assertDocumentSize(content: string): void {
  if (encodeUtf8Strict(content).byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("连续性资料更新后超过 32 MiB 限制。");
  }
}
