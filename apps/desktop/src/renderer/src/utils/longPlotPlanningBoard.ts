import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";

/** Projects existing plans and saved continuity references, without reading prose. */
export function projectLongPlotPlanningBoard(
  index: LongWorkspaceIndexSnapshot
) {
  const files = new Map(
    index.chapters.map((entry) => [entry.chapterCardId, entry])
  );
  const records = new Map<string, { state: string; handoff: string }>();
  for (const commit of index.ledger.commits) {
    const checkpoint = files.get(
      commit.checkpointChapterCardId ?? commit.chapterCardId
    );
    if (!checkpoint) continue;
    for (const chapterId of commit.chapterCardIds ?? [commit.chapterCardId])
      records.set(chapterId, {
        state: checkpoint.characterState.id,
        handoff: checkpoint.handoff.id
      });
  }
  const chapters = [...index.plot.chapterCards].sort(
    (a, b) => a.narrativeOrder - b.narrativeOrder
  );
  return [...index.plot.volumes]
    .sort((a, b) => a.order - b.order)
    .map((volume) => ({
      ...volume,
      chapters: chapters
        .filter((chapter) => chapter.volumeId === volume.id)
        .map((chapter) => {
          const entry = files.get(chapter.id);
          const savedRecord = records.get(chapter.id);
          return {
            ...chapter,
            outlineSelectionStatus: !chapter.outlineSelection
              ? ("unselected" as const)
              : chapter.outlineSelection.status === "current"
                ? ("current" as const)
                : chapter.outlineSelection.status === "needs-recheck"
                  ? ("needs-recheck" as const)
                  : ("unverified" as const),
            outlineSelection: chapter.outlineSelection,
            planFileId: entry?.card.id,
            planPath: entry?.card.path,
            bodyFileId: entry?.body.id,
            bodyEvidenceStatus:
              entry?.bodyEvidenceStatus ??
              (savedRecord ? "unknown" : undefined),
            recordFileId:
              savedRecord?.state ??
              (entry?.bodyStatus === "written"
                ? entry.characterState.id
                : undefined),
            handoffFileId: savedRecord?.handoff,
            status: savedRecord
              ? "recorded"
              : entry?.bodyStatus === "written"
                ? "written"
                : "planned"
          };
        })
    }));
}

/** A read-only continuity view from committed ledger/index data, with citations. */
export function projectLongPlotContinuity(index: LongWorkspaceIndexSnapshot) {
  const ledger = index.ledger.projection ?? {
    facts: [],
    knowledge: [],
    openLoops: [],
    latestHandoff: null
  };
  const factById = new Map(ledger.facts.map((fact) => [fact.factId, fact]));
  return {
    hasCommittedRecords: index.ledger.commits.length > 0,
    facts: ledger.facts.map((fact) => ({ ...fact })),
    knowledge: ledger.knowledge.map((item) => ({
      ...item,
      fact: factById.get(item.factId)
    })),
    openLoops: ledger.openLoops.filter(
      (loop) => loop.status === "open" || loop.status === "progressing"
    ),
    handoff: ledger.latestHandoff,
    foreshadowing: (index.plot.foreshadowing ?? []).map((thread) => ({
      id: thread.id,
      title: thread.title,
      status: thread.status,
      beats: thread.beats.map((beat) => ({
        id: beat.id,
        type: beat.type,
        status: beat.status,
        chapterCardId: beat.chapterCardId,
        plannedScope: beat.plannedScope
      }))
    }))
  };
}
