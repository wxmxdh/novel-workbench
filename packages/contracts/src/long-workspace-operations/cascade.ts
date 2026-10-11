import type {
  LongForeshadowingBeat,
  LongNarrativePlacement
} from "../long-workspace";
import {
  cleanupProjectionForDeletedEntity,
  refreshForeshadowingThreadStatus,
  removeBeatDecisionFromLedger,
  removeLedgerCommitForChapter,
  removePlacementDecisionFromLedger
} from "./ledger-cleanup";
import type { MutationState } from "./state";
import {
  addFileDeleteIntent,
  assertBeatIsMutable,
  assertChapterIsMutable,
  assertPlacementIsMutable,
  concreteChapterIdForBeat,
  findBeat,
  findEntityIndex,
  markDeleted,
  markUpdated,
  operationError,
  orderedChapterIds
} from "./state";

export { deleteCharacter } from "./cascade-character";

function ensureRetainedBeatHasAnchor(beat: LongForeshadowingBeat): void {
  if (
    beat.eventId !== null ||
    beat.placementId !== null ||
    beat.chapterCardId !== null ||
    (beat.volumeId ?? null) !== null ||
    (beat.arcId ?? null) !== null ||
    beat.plannedScope.trim().length > 0
  ) {
    return;
  }
  beat.plannedScope = "原关联对象已删除，待重新指定锚点。";
}

function retainBeatAfterPlacementDeletion(
  state: MutationState,
  beat: LongForeshadowingBeat,
  placement: LongNarrativePlacement
): void {
  if (beat.placementId !== placement.id) return;
  beat.placementId = null;
  beat.chapterCardId ??= placement.chapterCardId;
  beat.eventId ??= placement.eventId;
  ensureRetainedBeatHasAnchor(beat);
  markUpdated(state, beat.id);
}

export function deleteForeshadowingBeat(
  state: MutationState,
  beatId: string
): void {
  const { thread, beat, beatIndex } = findBeat(state.draft, beatId);
  assertBeatIsMutable(beat, "delete");
  removeBeatDecisionFromLedger(state, beat, thread.id);
  cleanupProjectionForDeletedEntity(state, beat.id);
  thread.beats.splice(beatIndex, 1);
  markDeleted(state, beat.id);
  markUpdated(state, thread.id);
  refreshForeshadowingThreadStatus(state, thread);
}

export function deleteNarrativePlacement(
  state: MutationState,
  placementId: string
): void {
  const placementIndex = findEntityIndex(
    state.draft.plot.narrativePlacements,
    placementId,
    "Narrative placement"
  );
  const placement = state.draft.plot.narrativePlacements[placementIndex]!;
  assertPlacementIsMutable(placement, "delete");
  state.draft.plot.foreshadowing.forEach((thread) =>
    thread.beats.forEach((beat) =>
      retainBeatAfterPlacementDeletion(state, beat, placement)
    )
  );
  removePlacementDecisionFromLedger(state, placement);
  cleanupProjectionForDeletedEntity(state, placement.id);
  state.draft.plot.narrativePlacements.splice(placementIndex, 1);
  markDeleted(state, placement.id);
}

export function deleteChapter(
  state: MutationState,
  chapterCardId: string
): void {
  assertChapterIsMutable(state.draft, chapterCardId, "delete");
  const chapterIndex = findEntityIndex(
    state.draft.plot.chapterCards,
    chapterCardId,
    "Chapter card"
  );
  const chapter = state.draft.plot.chapterCards[chapterIndex]!;
  const placementIds = state.draft.plot.narrativePlacements
    .filter((placement) => placement.chapterCardId === chapterCardId)
    .map(({ id }) => id);
  removeLedgerCommitForChapter(state, chapterCardId);
  for (const placementId of placementIds) {
    deleteNarrativePlacement(state, placementId);
  }
  state.draft.plot.foreshadowing.forEach((thread) => {
    thread.beats.forEach((beat) => {
      if (beat.chapterCardId !== chapterCardId) return;
      beat.chapterCardId = null;
      const event =
        beat.eventId === null
          ? undefined
          : state.draft.plot.storyEvents.find(({ id }) => id === beat.eventId);
      const eventSupportsVolume =
        !event ||
        event.arcIds.some(
          (arcId) =>
            state.draft.plot.arcs.find((arc) => arc.id === arcId)?.volumeId ===
            chapter.volumeId
        );
      const eventSupportsArc =
        chapter.primaryArcId !== null &&
        (!event || event.arcIds.includes(chapter.primaryArcId));
      if ((beat.volumeId ?? null) === null && eventSupportsVolume) {
        beat.volumeId = chapter.volumeId;
      }
      if ((beat.arcId ?? null) === null && eventSupportsArc) {
        beat.arcId = chapter.primaryArcId;
      }
      ensureRetainedBeatHasAnchor(beat);
      markUpdated(state, beat.id);
    });
  });
  cleanupProjectionForDeletedEntity(state, chapterCardId);

  const fileIndex = state.draft.chapters.findIndex(
    (entry) => entry.chapterCardId === chapterCardId
  );
  if (fileIndex < 0) {
    operationError(
      "invalid_result",
      `Chapter ${chapterCardId} is missing its file index.`
    );
  }
  const files = state.draft.chapters[fileIndex]!;
  [
    files.body,
    files.card,
    files.characterState,
    files.handoff,
    files.foreshadowingChanges,
    ...(files.worldReveals ? [files.worldReveals] : []),
    ...files.characterContinuity.flatMap((character) => [
      character.currentState,
      character.history
    ])
  ].forEach((file) =>
    addFileDeleteIntent(state, file, `Delete chapter ${chapterCardId}`)
  );
  state.draft.chapters.splice(fileIndex, 1);
  state.draft.plot.chapterCards.splice(chapterIndex, 1);
  const recordedChapterIds = new Set(
    state.draft.chapters
      .filter(({ commitId }) => commitId !== null)
      .map(({ chapterCardId }) => chapterCardId)
  );
  state.draft.ledger.committedThroughChapterId = null;
  for (const orderedChapterId of orderedChapterIds(state.draft)) {
    if (!recordedChapterIds.has(orderedChapterId)) break;
    state.draft.ledger.committedThroughChapterId = orderedChapterId;
  }
  markDeleted(state, chapter.id);
}

export function deleteStoryPlot(
  state: MutationState,
  storyPlotId: string
): void {
  const storyPlotIndex = findEntityIndex(
    state.draft.plot.storyPlots,
    storyPlotId,
    "Story plot"
  );
  const storyPlot = state.draft.plot.storyPlots[storyPlotIndex]!;
  addFileDeleteIntent(
    state,
    storyPlot.file,
    `Delete story plot ${storyPlotId}`
  );
  cleanupProjectionForDeletedEntity(state, storyPlot.id);
  state.draft.plot.storyPlots.splice(storyPlotIndex, 1);
  markDeleted(state, storyPlot.id);
}

export function deleteArc(state: MutationState, arcId: string): void {
  const arcIndex = findEntityIndex(state.draft.plot.arcs, arcId, "Arc");
  const arc = state.draft.plot.arcs[arcIndex]!;
  const storyPlotIds = state.draft.plot.storyPlots
    .filter((storyPlot) => storyPlot.arcId === arcId)
    .map(({ id }) => id);
  state.draft.plot.foreshadowing.forEach((thread) =>
    thread.beats.forEach((beat) => {
      if ((beat.arcId ?? null) !== arcId) return;
      assertBeatIsMutable(beat, "unlink from its deleted planning arc");
      beat.arcId = null;
      ensureRetainedBeatHasAnchor(beat);
      markUpdated(state, beat.id);
    })
  );
  state.draft.plot.chapterCards.forEach((chapter) => {
    if (chapter.primaryArcId !== arcId) return;
    chapter.primaryArcId = null;
    markUpdated(state, chapter.id);
  });
  storyPlotIds.forEach((storyPlotId) => deleteStoryPlot(state, storyPlotId));
  state.draft.plot.storyEvents.forEach((event) => {
    if (!event.arcIds.includes(arcId)) return;
    event.arcIds = event.arcIds.filter((candidate) => candidate !== arcId);
    markUpdated(state, event.id);
    const remainingVolumeIds = [
      ...new Set(
        event.arcIds
          .map(
            (eventArcId) =>
              state.draft.plot.arcs.find(
                (candidate) => candidate.id === eventArcId
              )?.volumeId
          )
          .filter((volumeId): volumeId is string => Boolean(volumeId))
      )
    ];
    state.draft.plot.foreshadowing.forEach((thread) => {
      thread.beats.forEach((beat) => {
        const plannedVolumeId = beat.volumeId ?? null;
        if (
          beat.eventId !== event.id ||
          plannedVolumeId === null ||
          remainingVolumeIds.includes(plannedVolumeId)
        ) {
          return;
        }
        assertBeatIsMutable(beat, "retarget after deleting its event arc");
        const concreteChapterId = concreteChapterIdForBeat(state.draft, beat);
        beat.volumeId =
          concreteChapterId === null && remainingVolumeIds.length === 1
            ? remainingVolumeIds[0]!
            : null;
        markUpdated(state, beat.id);
      });
    });
  });
  cleanupProjectionForDeletedEntity(state, arc.id);
  state.draft.plot.arcs.splice(
    findEntityIndex(state.draft.plot.arcs, arcId, "Arc"),
    1
  );
  markDeleted(state, arc.id);
}

export function deleteVolume(state: MutationState, volumeId: string): void {
  const volumeIndex = findEntityIndex(
    state.draft.plot.volumes,
    volumeId,
    "Volume"
  );
  const volume = state.draft.plot.volumes[volumeIndex]!;
  const chapterIds = state.draft.plot.chapterCards
    .filter((chapter) => chapter.volumeId === volumeId)
    .map(({ id }) => id);
  const arcIds = state.draft.plot.arcs
    .filter((arc) => arc.volumeId === volumeId)
    .map(({ id }) => id);
  chapterIds.forEach((chapterId) => deleteChapter(state, chapterId));
  arcIds.forEach((arcId) => deleteArc(state, arcId));
  state.draft.plot.foreshadowing.forEach((thread) =>
    thread.beats.forEach((beat) => {
      if ((beat.volumeId ?? null) !== volumeId) return;
      assertBeatIsMutable(beat, "unlink from its deleted planning volume");
      beat.volumeId = null;
      ensureRetainedBeatHasAnchor(beat);
      markUpdated(state, beat.id);
    })
  );
  cleanupProjectionForDeletedEntity(state, volume.id);
  state.draft.plot.volumes.splice(
    findEntityIndex(state.draft.plot.volumes, volumeId, "Volume"),
    1
  );
  markDeleted(state, volume.id);
}

export function deleteStoryEvent(state: MutationState, eventId: string): void {
  const eventIndex = findEntityIndex(
    state.draft.plot.storyEvents,
    eventId,
    "Story event"
  );
  const event = state.draft.plot.storyEvents[eventIndex]!;
  const connectionIds = state.draft.plot.eventConnections
    .filter(
      (connection) =>
        connection.sourceEventId === eventId ||
        connection.targetEventId === eventId
    )
    .map(({ id }) => id);
  const placementIds = state.draft.plot.narrativePlacements
    .filter((placement) => placement.eventId === eventId)
    .map(({ id }) => id);
  placementIds.forEach((placementId) =>
    deleteNarrativePlacement(state, placementId)
  );
  state.draft.plot.foreshadowing.forEach((thread) =>
    thread.beats.forEach((beat) => {
      if (beat.eventId !== eventId) return;
      assertBeatIsMutable(beat, "unlink from its deleted event");
      beat.eventId = null;
      ensureRetainedBeatHasAnchor(beat);
      markUpdated(state, beat.id);
    })
  );
  connectionIds.forEach((connectionId) => {
    const index = findEntityIndex(
      state.draft.plot.eventConnections,
      connectionId,
      "Event connection"
    );
    cleanupProjectionForDeletedEntity(state, connectionId);
    state.draft.plot.eventConnections.splice(index, 1);
    markDeleted(state, connectionId);
  });
  state.draft.plot.foreshadowing.forEach((thread) => {
    if (thread.truthEventId !== eventId) return;
    thread.truthEventId = null;
    markUpdated(state, thread.id);
  });
  cleanupProjectionForDeletedEntity(state, event.id);
  state.draft.plot.storyEvents.splice(eventIndex, 1);
  markDeleted(state, event.id);
}

export function deleteForeshadowingThread(
  state: MutationState,
  threadId: string
): void {
  const threadIndex = findEntityIndex(
    state.draft.plot.foreshadowing,
    threadId,
    "Foreshadowing thread"
  );
  const thread = state.draft.plot.foreshadowing[threadIndex]!;
  [...thread.beats].forEach((beat) => deleteForeshadowingBeat(state, beat.id));
  cleanupProjectionForDeletedEntity(state, thread.id);
  state.draft.plot.foreshadowing.splice(threadIndex, 1);
  markDeleted(state, thread.id);
}
