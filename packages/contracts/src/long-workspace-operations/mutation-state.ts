import type {
  LongForeshadowing,
  LongForeshadowingBeat,
  LongNarrativePlacement,
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot
} from "../long-workspace";
import { chapterMutationViolation } from "./chapter-mutation-guard";
import type {
  LongWorkspaceFileIntent,
  LongWorkspaceLedgerRecordEdit,
  LongWorkspaceOperationErrorCode
} from "./impact-schema";
import { LongWorkspaceOperationError } from "./impact-schema";

export type MutationState = {
  original: LongWorkspaceIndexSnapshot;
  draft: LongWorkspaceIndexSnapshot;
  createdEntityIds: Set<string>;
  updatedEntityIds: Set<string>;
  deletedEntityIds: Set<string>;
  fileIntents: Map<string, LongWorkspaceFileIntent>;
  ledgerRecordEdits: Map<string, LongWorkspaceLedgerRecordEdit>;
  provisionalIdMap: Record<string, string>;
  updatedAt: string;
};

export function operationError(
  code: LongWorkspaceOperationErrorCode,
  message: string
): never {
  throw new LongWorkspaceOperationError(code, message);
}

export function findEntityIndex<T extends { id: string }>(
  values: readonly T[],
  id: string,
  label: string
): number {
  const index = values.findIndex((value) => value.id === id);
  if (index < 0) {
    operationError("not_found", `${label} ${id} does not exist.`);
  }
  return index;
}

export function findBeat(
  workspace: LongWorkspaceIndexSnapshot,
  beatId: string
): {
  thread: LongForeshadowing;
  threadIndex: number;
  beat: LongForeshadowingBeat;
  beatIndex: number;
} {
  for (
    let threadIndex = 0;
    threadIndex < workspace.plot.foreshadowing.length;
    threadIndex += 1
  ) {
    const thread = workspace.plot.foreshadowing[threadIndex]!;
    const beatIndex = thread.beats.findIndex((beat) => beat.id === beatId);
    if (beatIndex >= 0) {
      return {
        thread,
        threadIndex,
        beat: thread.beats[beatIndex]!,
        beatIndex
      };
    }
  }
  return operationError(
    "not_found",
    `Foreshadowing beat ${beatId} does not exist.`
  );
}

export function markCreated(state: MutationState, id: string): void {
  if (
    state.createdEntityIds.has(id) ||
    state.updatedEntityIds.has(id) ||
    state.deletedEntityIds.has(id)
  ) {
    operationError(
      "already_exists",
      `Entity ${id} is already part of this operation batch.`
    );
  }
  state.createdEntityIds.add(id);
}

export function markUpdated(state: MutationState, id: string): void {
  if (!state.createdEntityIds.has(id) && !state.deletedEntityIds.has(id)) {
    state.updatedEntityIds.add(id);
  }
}

export function markDeleted(state: MutationState, id: string): void {
  if (state.createdEntityIds.delete(id)) {
    state.updatedEntityIds.delete(id);
    return;
  }
  state.updatedEntityIds.delete(id);
  state.deletedEntityIds.add(id);
}

export function registerProvisionalId(
  state: MutationState,
  provisionalId: string | undefined,
  stableId: string
): void {
  if (!provisionalId) return;
  if (state.provisionalIdMap[provisionalId]) {
    operationError(
      "already_exists",
      `Provisional id ${provisionalId} is already mapped.`
    );
  }
  state.provisionalIdMap[provisionalId] = stableId;
}

export function allWorkspaceFiles(
  workspace: LongWorkspaceIndexSnapshot
): LongWorkspaceFileReference[] {
  return [
    workspace.bookLine,
    ...workspace.worldbuilding.flatMap((category) =>
      category.format === "text"
        ? [category.file]
        : [
            ...(category.overview ? [category.overview] : []),
            ...category.items.map(({ file }) => file)
          ]
    ),
    ...(workspace.characterOverview ? [workspace.characterOverview] : []),
    ...workspace.characterFiles.flatMap((entry) => [
      entry.coreProfile,
      entry.relationships
    ]),
    ...workspace.chapters.flatMap((entry) => [
      entry.body,
      entry.card,
      entry.characterState,
      entry.handoff,
      entry.foreshadowingChanges,
      ...(entry.worldReveals ? [entry.worldReveals] : []),
      ...entry.characterContinuity.flatMap((character) => [
        character.currentState,
        character.history
      ])
    ]),
    ...workspace.plot.storyPlots.map(({ file }) => file),
    ...workspace.ledger.commits.map(({ recordFile }) => recordFile)
  ];
}

export function ensureFilesAvailable(
  state: MutationState,
  files: readonly LongWorkspaceFileReference[]
): void {
  const existingFiles = allWorkspaceFiles(state.draft);
  const knownIds = new Set(existingFiles.map(({ id }) => id));
  const knownPaths = new Set(existingFiles.map(({ path }) => path));
  for (const file of files) {
    if (knownIds.has(file.id) || state.fileIntents.has(file.id)) {
      operationError(
        "already_exists",
        `Long-form file id ${file.id} already exists.`
      );
    }
    if (knownPaths.has(file.path)) {
      operationError(
        "already_exists",
        `Long-form file path ${file.path} already exists.`
      );
    }
    knownIds.add(file.id);
    knownPaths.add(file.path);
  }
}

export function addFileCreateIntent(
  state: MutationState,
  file: LongWorkspaceFileReference,
  reason: string
): void {
  const existing = state.fileIntents.get(file.id);
  if (existing) {
    operationError(
      "already_exists",
      `File ${file.id} already has a pending ${existing.action} intent.`
    );
  }
  state.fileIntents.set(file.id, {
    action: "create",
    file: structuredClone(file),
    reason
  });
}

export function addFileDeleteIntent(
  state: MutationState,
  file: LongWorkspaceFileReference,
  reason: string
): void {
  const existing = state.fileIntents.get(file.id);
  if (existing?.action === "create") {
    state.fileIntents.delete(file.id);
    return;
  }
  state.fileIntents.set(file.id, {
    action: "delete",
    file: structuredClone(file),
    reason
  });
}

export function assertChapterIsMutable(
  workspace: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  action: string
): void {
  void workspace;
  void chapterCardId;
  void action;
}

export function assertChapterContinuityIsMutable(
  workspace: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  action: string
): void {
  const violation = chapterMutationViolation(workspace, chapterCardId, action);
  if (violation) operationError(violation.code, violation.message);
}

export function assertPlacementIsMutable(
  placement: LongNarrativePlacement,
  action: string
): void {
  void placement;
  void action;
}

export function assertBeatIsMutable(
  beat: LongForeshadowingBeat,
  action: string
): void {
  void beat;
  void action;
}

export function concreteChapterIdForBeat(
  workspace: LongWorkspaceIndexSnapshot,
  beat: LongForeshadowingBeat
): string | null {
  if (beat.chapterCardId !== null) return beat.chapterCardId;
  if (beat.placementId === null) return null;
  return (
    workspace.plot.narrativePlacements.find(
      (placement) => placement.id === beat.placementId
    )?.chapterCardId ?? null
  );
}

export function retargetBeatPlanningAnchorsToChapter(
  state: MutationState,
  beat: LongForeshadowingBeat,
  chapter: {
    id: string;
    volumeId: string;
    primaryArcId: string | null;
  },
  action: string
): void {
  const hasVolumeAnchor = (beat.volumeId ?? null) !== null;
  const hasArcAnchor = (beat.arcId ?? null) !== null;
  const volumeChanged = hasVolumeAnchor && beat.volumeId !== chapter.volumeId;
  const arcChanged = hasArcAnchor && beat.arcId !== chapter.primaryArcId;
  if (!volumeChanged && !arcChanged) return;

  assertBeatIsMutable(beat, action);
  const event =
    beat.eventId === null
      ? undefined
      : state.draft.plot.storyEvents[
          findEntityIndex(
            state.draft.plot.storyEvents,
            beat.eventId,
            "Foreshadowing beat event"
          )
        ];
  const eventSupportsTargetVolume =
    !event ||
    event.arcIds.some(
      (eventArcId) =>
        state.draft.plot.arcs.find((candidate) => candidate.id === eventArcId)
          ?.volumeId === chapter.volumeId
    );
  const eventSupportsTargetArc =
    chapter.primaryArcId !== null &&
    (!event || event.arcIds.includes(chapter.primaryArcId));
  if (hasVolumeAnchor) {
    beat.volumeId = eventSupportsTargetVolume ? chapter.volumeId : null;
  }
  if (hasArcAnchor) {
    beat.arcId = eventSupportsTargetArc ? chapter.primaryArcId : null;
  }
  markUpdated(state, beat.id);
}
