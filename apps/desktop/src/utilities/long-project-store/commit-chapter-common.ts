import { createHash } from "node:crypto";
import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerRecordChapterIds,
  longLedgerCommitFileId,
  type LongCommitChapterResult,
  type LongLedgerCommitRecord,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { deriveLongForeshadowingStatus } from "./continuity";
import { commitLongProjectTransaction, serializeJson } from "./io";
import { loadIndexedFile } from "./cache";
import { encodeUtf8Strict } from "./utf8";
import { contiguousRecordedThrough, ledgerPath } from "./paths";
import type { LongProjectStoreContext } from "./store-context";
import {
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type LoadedLongProject
} from "./types";

export interface ChapterCommitTargets {
  placements: LongWorkspaceIndexSnapshot["plot"]["narrativePlacements"];
  beats: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"][number]["beats"];
  foreshadowingIdByBeatId: Map<string, string>;
}

export function collectChapterCommitTargets(
  index: LongWorkspaceIndexSnapshot,
  chapterCardId: string
): ChapterCommitTargets {
  const placements = index.plot.narrativePlacements.filter(
    (placement) => placement.chapterCardId === chapterCardId
  );
  const placementById = new Map(
    index.plot.narrativePlacements.map((placement) => [placement.id, placement])
  );
  const beats = index.plot.foreshadowing.flatMap((thread) =>
    thread.beats.filter((beat) => {
      const placement =
        beat.placementId === null
          ? undefined
          : placementById.get(beat.placementId);
      return (
        (beat.chapterCardId ?? placement?.chapterCardId ?? null) ===
        chapterCardId
      );
    })
  );
  return {
    placements,
    beats,
    foreshadowingIdByBeatId: new Map(
      index.plot.foreshadowing.flatMap((thread) =>
        thread.beats.map((beat) => [beat.id, thread.id] as const)
      )
    )
  };
}

export function collectChapterBatchCommitTargets(
  index: LongWorkspaceIndexSnapshot,
  chapterCardIds: readonly string[]
): ChapterCommitTargets {
  const chapterIds = new Set(chapterCardIds);
  const placementById = new Map(
    index.plot.narrativePlacements.map((placement) => [placement.id, placement])
  );
  return {
    placements: index.plot.narrativePlacements.filter((placement) =>
      chapterIds.has(placement.chapterCardId)
    ),
    beats: index.plot.foreshadowing.flatMap((thread) =>
      thread.beats.filter((beat) => {
        const placement =
          beat.placementId === null
            ? undefined
            : placementById.get(beat.placementId);
        const chapterCardId = beat.chapterCardId ?? placement?.chapterCardId;
        return chapterCardId !== undefined && chapterIds.has(chapterCardId);
      })
    ),
    foreshadowingIdByBeatId: new Map(
      index.plot.foreshadowing.flatMap((thread) =>
        thread.beats.map((beat) => [beat.id, thread.id] as const)
      )
    )
  };
}

export function applyChapterDecisions(input: {
  index: LongWorkspaceIndexSnapshot;
  targets: ChapterCommitTargets;
  commitId: string;
  placementDecisions: Record<
    string,
    { status: "committed" | "missed"; note: string }
  > | null;
  beatDecisions: Record<
    string,
    { status: "committed" | "missed"; note: string }
  >;
}): Pick<
  LongLedgerCommitRecord,
  "placementChanges" | "foreshadowingBeatChanges" | "foreshadowingThreadChanges"
> {
  const placementChanges: LongLedgerCommitRecord["placementChanges"] =
    input.targets.placements.map((placement) => {
      const decision = input.placementDecisions?.[placement.id] ?? {
        status: "committed" as const,
        note: ""
      };
      placement.status = decision.status;
      placement.commitId = input.commitId;
      return {
        placementId: placement.id,
        after: { status: decision.status, commitId: input.commitId },
        note: decision.note
      };
    });
  const foreshadowingBeatChanges: LongLedgerCommitRecord["foreshadowingBeatChanges"] =
    input.targets.beats.map((beat) => {
      const decision = input.beatDecisions[beat.id]!;
      beat.status = decision.status;
      beat.commitId = input.commitId;
      return {
        foreshadowingId: input.targets.foreshadowingIdByBeatId.get(beat.id),
        beatId: beat.id,
        after: { status: decision.status, commitId: input.commitId },
        note: decision.note
      };
    });
  const decidedBeatIds = new Set(input.targets.beats.map(({ id }) => id));
  const foreshadowingThreadChanges: LongLedgerCommitRecord["foreshadowingThreadChanges"] =
    input.index.plot.foreshadowing
      .filter((thread) =>
        thread.beats.some((beat) => decidedBeatIds.has(beat.id))
      )
      .map((thread) => {
        const after = deriveLongForeshadowingStatus(thread);
        thread.status = after;
        return { foreshadowingId: thread.id, after };
      });
  return {
    placementChanges,
    foreshadowingBeatChanges,
    foreshadowingThreadChanges
  };
}

export async function finishChapterCommit(input: {
  ctx: LongProjectStoreContext;
  loaded: LoadedLongProject;
  chapterEntries: readonly LongWorkspaceIndexSnapshot["chapters"][number][];
  record: LongLedgerCommitRecord;
  mode: "structured" | "text_files" | "text_files_batch";
  fileOperations?: readonly ProjectTransactionFileOperation[];
}): Promise<LongCommitChapterResult> {
  const chapterBodyEvidence = await Promise.all(
    input.chapterEntries.map(async (entry) => {
      const body = await loadIndexedFile(input.loaded, entry.body.id);
      if (body.kind !== "markdown")
        throw new Error("Committed chapter body must be Markdown.");
      return {
        chapterCardId: entry.chapterCardId,
        bodyFileId: entry.body.id,
        sha256: createHash("sha256")
          .update(encodeUtf8Strict(body.disk.content))
          .digest("hex")
      };
    })
  );
  input.record.chapterBodyEvidence = chapterBodyEvidence;
  const timestamp = input.record.committedAt;
  const recordContent = serializeJson(input.record);
  const recordReference: LongWorkspaceFileReference = {
    id: longLedgerCommitFileId(input.record.id),
    path: ledgerPath(input.record.id),
    updatedAt: timestamp
  };
  const chapterCardIds = longLedgerRecordChapterIds(input.record);
  for (const chapterEntry of input.chapterEntries) {
    chapterEntry.commitId = input.record.id;
    chapterEntry.bodyEvidenceStatus = "current";
  }
  input.loaded.index.ledger.committedThroughChapterId =
    input.record.committedThroughChapterId;
  const batchFields =
    input.mode === "text_files_batch"
      ? {
          chapterCardIds,
          checkpointChapterCardId: input.record.chapterCardId
        }
      : {};
  input.loaded.index.ledger.commits.push({
    id: input.record.id,
    mode: input.mode,
    sequence: input.record.sequence,
    chapterCardId: input.record.chapterCardId,
    ...batchFields,
    committedAt: timestamp,
    chapterBodyEvidence,
    placementIds: input.record.placementChanges.map(
      ({ placementId }) => placementId
    ),
    foreshadowingBeatIds: input.record.foreshadowingBeatChanges.map(
      ({ beatId }) => beatId
    ),
    recordFile: recordReference
  });
  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...input.loaded.index,
    updatedAt: timestamp
  });
  const nextManifest = LongProjectManifestSchema.parse({
    ...input.loaded.manifest,
    updatedAt: timestamp,
    workspaceIndexFile: {
      ...input.loaded.manifest.workspaceIndexFile,
      updatedAt: timestamp
    }
  });
  await commitLongProjectTransaction({
    projectRoot: input.loaded.projectDirectory,
    operations: [
      ...(input.fileOperations ?? []),
      {
        path: recordReference.path,
        content: recordContent,
        expectedSha256: null
      },
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: serializeJson(nextIndex)
      },
      { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
    ],
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return { record: input.record };
}

export function committedThroughChapterId(
  index: LongWorkspaceIndexSnapshot,
  chapterCardIds: string | readonly string[]
): string | null {
  return contiguousRecordedThrough(index, chapterCardIds);
}
