import {
  LongContinuityProjectionSchema,
  deriveLongForeshadowingStatusFromCommittedBeats,
  type LongContinuityHandoff,
  type LongContinuityProjection,
  type LongForeshadowing,
  type LongForeshadowingStatus,
  type LongLedgerCommitRecord,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { LongStructuredCommitChapterInput } from "./types";

export function continuityFactKey(
  value: Pick<
    LongContinuityProjection["facts"][number],
    "domain" | "subjectId" | "field"
  >
): string {
  return `${value.domain}\0${value.subjectId}\0${value.field.normalize("NFC")}`;
}

export function continuityKnowledgeKey(
  value: Pick<
    LongContinuityProjection["knowledge"][number],
    "factId" | "audienceType" | "audienceId"
  >
): string {
  return `${value.factId}\0${value.audienceType}\0${value.audienceId ?? ""}`;
}

export function assertLongContinuityMutationAuthority(
  index: LongWorkspaceIndexSnapshot,
  input: LongStructuredCommitChapterInput
): void {
  const characterIds = new Set(index.characters.map(({ id }) => id));
  const worldIds = new Set(index.worldbuilding.map(({ id }) => id));
  const plotIds = new Set<string>([
    index.bookId,
    ...index.plot.volumes.map(({ id }) => id),
    ...index.plot.arcs.map(({ id }) => id),
    ...index.plot.chapterCards.map(({ id }) => id),
    ...index.plot.storyEvents.map(({ id }) => id),
    ...index.plot.eventConnections.map(({ id }) => id),
    ...index.plot.narrativePlacements.map(({ id }) => id)
  ]);
  const foreshadowingIds = new Set<string>(
    index.plot.foreshadowing.flatMap((thread) => [
      thread.id,
      ...thread.beats.map(({ id }) => id)
    ])
  );
  const updatedFileIds = new Set(input.fileUpdates.map(({ fileId }) => fileId));
  const characterFilesById = new Map(
    index.characterFiles.map((entry) => [entry.characterId, entry] as const)
  );

  for (const fact of input.factMutations) {
    const subjectExists =
      fact.domain === "character" || fact.domain === "relationship"
        ? characterIds.has(fact.subjectId)
        : fact.domain === "world"
          ? worldIds.has(fact.subjectId)
          : fact.domain === "plot"
            ? plotIds.has(fact.subjectId)
            : foreshadowingIds.has(fact.subjectId);
    if (!subjectExists) {
      throw new Error(
        `连续性事实 ${fact.factId} 的 ${fact.domain} subjectId 未关联工作区现有对象：${fact.subjectId}。`
      );
    }
    if (fact.domain !== "character" && fact.domain !== "relationship") {
      continue;
    }
    const files = characterFilesById.get(fact.subjectId);
    const chapterFiles = index.chapters
      .find(({ chapterCardId }) => chapterCardId === input.chapterCardId)
      ?.characterContinuity.find(
        ({ characterId }) => characterId === fact.subjectId
      );
    if (!files || !chapterFiles) {
      throw new Error(
        `连续性事实 ${fact.factId} 缺少人物物化文件：${fact.subjectId}。`
      );
    }
    const requiredFiles =
      fact.domain === "character"
        ? [chapterFiles.currentState.id, chapterFiles.history.id]
        : [files.relationships.id, chapterFiles.history.id];
    if (requiredFiles.some((fileId) => !updatedFileIds.has(fileId))) {
      throw new Error(
        fact.domain === "character"
          ? `人物事实 ${fact.factId} 必须同步更新人物当前状态和历史轨迹。`
          : `关系事实 ${fact.factId} 必须同步更新人物关系和历史轨迹。`
      );
    }
  }
}

export function materializeLongContinuityProjection(input: {
  projection: LongContinuityProjection;
  commitId: string;
  chapterCardId: string;
  factMutations: LongStructuredCommitChapterInput["factMutations"];
  knowledgeMutations: LongStructuredCommitChapterInput["knowledgeMutations"];
  openLoopMutations: LongStructuredCommitChapterInput["openLoopMutations"];
  handoff: LongContinuityHandoff;
}): {
  projection: LongContinuityProjection;
  factChanges: LongLedgerCommitRecord["factChanges"];
  knowledgeChanges: LongLedgerCommitRecord["knowledgeChanges"];
  openLoopChanges: LongLedgerCommitRecord["openLoopChanges"];
} {
  const projection: LongContinuityProjection = {
    throughCommitId: input.projection.throughCommitId,
    facts: input.projection.facts.map((fact) => ({ ...fact })),
    knowledge: input.projection.knowledge.map((knowledge) => ({
      ...knowledge
    })),
    openLoops: input.projection.openLoops.map((loop) => ({ ...loop })),
    latestHandoff:
      input.projection.latestHandoff === null
        ? null
        : {
            ...input.projection.latestHandoff,
            mustCarry: [...input.projection.latestHandoff.mustCarry],
            nextChapterConstraints: [
              ...input.projection.latestHandoff.nextChapterConstraints
            ],
            openLoops: [...input.projection.latestHandoff.openLoops]
          }
  };
  const factChanges: LongLedgerCommitRecord["factChanges"] = [];
  const factIndexById = new Map(
    projection.facts.map((fact, index) => [fact.factId, index] as const)
  );
  const factIndexByKey = new Map(
    projection.facts.map(
      (fact, index) => [continuityFactKey(fact), index] as const
    )
  );
  for (const mutation of input.factMutations) {
    const key = continuityFactKey(mutation);
    const idIndex = factIndexById.get(mutation.factId);
    const keyIndex = factIndexByKey.get(key);
    if (
      (idIndex === undefined) !== (keyIndex === undefined) ||
      (idIndex !== undefined && keyIndex !== undefined && idIndex !== keyIndex)
    ) {
      throw new Error(
        `连续性事实 ${mutation.factId} 不能更换事实 ID 或逻辑键。`
      );
    }
    const after: LongContinuityProjection["facts"][number] = {
      ...mutation,
      sourceCommitId: input.commitId,
      sourceChapterCardId: input.chapterCardId
    };
    factChanges.push({ after: { ...after } });
    if (idIndex === undefined) {
      const nextIndex = projection.facts.length;
      projection.facts.push(after);
      factIndexById.set(after.factId, nextIndex);
      factIndexByKey.set(key, nextIndex);
    } else {
      projection.facts[idIndex] = after;
    }
  }

  const projectedFactIds = new Set(
    projection.facts.map(({ factId }) => factId)
  );
  const knowledgeChanges: LongLedgerCommitRecord["knowledgeChanges"] = [];
  const knowledgeIndexByKey = new Map(
    projection.knowledge.map(
      (knowledge, index) => [continuityKnowledgeKey(knowledge), index] as const
    )
  );
  for (const mutation of input.knowledgeMutations) {
    if (!projectedFactIds.has(mutation.factId)) {
      throw new Error(`连续性认知引用了不存在的事实：${mutation.factId}。`);
    }
    const key = continuityKnowledgeKey(mutation);
    const existingIndex = knowledgeIndexByKey.get(key);
    const after: LongContinuityProjection["knowledge"][number] = {
      ...mutation,
      sourceCommitId: input.commitId,
      sourceChapterCardId: input.chapterCardId
    };
    knowledgeChanges.push({ after: { ...after } });
    if (existingIndex === undefined) {
      knowledgeIndexByKey.set(key, projection.knowledge.length);
      projection.knowledge.push(after);
    } else {
      projection.knowledge[existingIndex] = after;
    }
  }

  const openLoopChanges: LongLedgerCommitRecord["openLoopChanges"] = [];
  const openLoopIndexById = new Map(
    projection.openLoops.map((loop, index) => [loop.loopId, index] as const)
  );
  for (const mutation of input.openLoopMutations) {
    if (mutation.factId !== null && !projectedFactIds.has(mutation.factId)) {
      throw new Error(`未闭合事项引用了不存在的事实：${mutation.factId}。`);
    }
    const existingIndex = openLoopIndexById.get(mutation.loopId);
    const after: LongContinuityProjection["openLoops"][number] = {
      ...mutation,
      sourceCommitId: input.commitId,
      sourceChapterCardId: input.chapterCardId
    };
    openLoopChanges.push({ after: { ...after } });
    if (existingIndex === undefined) {
      openLoopIndexById.set(after.loopId, projection.openLoops.length);
      projection.openLoops.push(after);
    } else {
      projection.openLoops[existingIndex] = after;
    }
  }

  projection.throughCommitId = input.commitId;
  projection.latestHandoff = {
    ...input.handoff,
    mustCarry: [...input.handoff.mustCarry],
    nextChapterConstraints: [...input.handoff.nextChapterConstraints],
    openLoops: [...input.handoff.openLoops],
    chapterCardId: input.chapterCardId,
    commitId: input.commitId
  };
  return {
    projection: LongContinuityProjectionSchema.parse(projection),
    factChanges,
    knowledgeChanges,
    openLoopChanges
  };
}

export function serializeLongContinuityHandoff(
  handoff: LongContinuityHandoff
): string {
  const bullets = (items: readonly string[]): string =>
    items.length === 0
      ? "- 无"
      : items
          .map(
            (item) =>
              `- ${item.replace(/\r\n?/gu, "\n").replace(/\n/gu, "\n  ")}`
          )
          .join("\n");
  return [
    "# 下一章交接",
    "",
    "## 摘要",
    "",
    handoff.summary,
    "",
    "## 必须承接",
    "",
    bullets(handoff.mustCarry),
    "",
    "## 下一章约束",
    "",
    bullets(handoff.nextChapterConstraints),
    "",
    "## 未闭合事项",
    "",
    bullets(handoff.openLoops),
    ""
  ].join("\n");
}

export function appendLongCharacterHistoryEntry(
  existing: string,
  entry: {
    chapterCardId: string;
    commitId: string;
    committedAt: string;
    content: string;
  }
): string {
  const separator =
    existing.length === 0
      ? ""
      : existing.endsWith("\n\n")
        ? ""
        : existing.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${existing}${separator}## 章节 ${entry.chapterCardId} · ${entry.committedAt}\n\n提交：${entry.commitId}\n\n${entry.content.trim()}\n`;
}

export function deriveLongForeshadowingStatus(
  thread: LongForeshadowing
): LongForeshadowingStatus {
  if (thread.status === "abandoned") return "abandoned";
  return deriveLongForeshadowingStatusFromCommittedBeats(thread.beats);
}
