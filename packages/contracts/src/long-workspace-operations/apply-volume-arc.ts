import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";
import { deleteArc, deleteVolume } from "./cascade";
import {
  assertBeatIsMutable,
  assertExactOrder,
  assertNewEntityId,
  concreteChapterIdForBeat,
  findEntityIndex,
  insertBeforeId,
  markCreated,
  markUpdated,
  nextOrder,
  registerProvisionalId,
  updateOrdersById
} from "./state";

export function applyVolumeArcOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "volume.create": {
      assertNewEntityId(workspace.plot.volumes, operation.volume.id, "Volume");
      const volume = structuredClone(operation.volume);
      volume.order = nextOrder(
        workspace.plot.volumes.map(({ order }) => order)
      );
      workspace.plot.volumes.push(volume);
      markCreated(state, operation.volume.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.volume.id
      );
      break;
    }
    case "volume.update": {
      const volume =
        workspace.plot.volumes[
          findEntityIndex(workspace.plot.volumes, operation.id, "Volume")
        ]!;
      Object.assign(volume, operation.patch);
      markUpdated(state, volume.id);
      break;
    }
    case "volume.delete":
      deleteVolume(state, operation.id);
      break;
    case "volume.reorder":
      assertExactOrder(
        workspace.plot.volumes.map(({ id }) => id),
        operation.orderedIds,
        "Volume"
      );
      updateOrdersById(
        workspace.plot.volumes,
        operation.orderedIds,
        (volume, order) => {
          volume.order = order;
        },
        state
      );
      break;
    case "arc.create": {
      assertNewEntityId(workspace.plot.arcs, operation.arc.id, "Arc");
      const arc = structuredClone(operation.arc);
      arc.order = nextOrder(
        workspace.plot.arcs
          .filter((candidate) => candidate.volumeId === arc.volumeId)
          .map(({ order }) => order)
      );
      workspace.plot.arcs.push(arc);
      markCreated(state, operation.arc.id);
      registerProvisionalId(state, operation.provisionalId, operation.arc.id);
      break;
    }
    case "arc.update": {
      const arc =
        workspace.plot.arcs[
          findEntityIndex(workspace.plot.arcs, operation.id, "Arc")
        ]!;
      Object.assign(arc, operation.patch);
      markUpdated(state, arc.id);
      break;
    }
    case "arc.delete":
      deleteArc(state, operation.id);
      break;
    case "arc.move": {
      findEntityIndex(
        workspace.plot.volumes,
        operation.toVolumeId,
        "Target volume"
      );
      const arc =
        workspace.plot.arcs[
          findEntityIndex(workspace.plot.arcs, operation.id, "Arc")
        ]!;
      const sourceVolumeId = arc.volumeId;
      const linkedChapters = workspace.plot.chapterCards.filter(
        (chapter) => chapter.primaryArcId === arc.id
      );
      arc.volumeId = operation.toVolumeId;
      if (sourceVolumeId !== operation.toVolumeId) {
        linkedChapters.forEach((chapter) => {
          chapter.primaryArcId = null;
          markUpdated(state, chapter.id);
        });
        workspace.plot.foreshadowing.forEach((thread) => {
          thread.beats.forEach((beat) => {
            const followsMovedArc = (beat.arcId ?? null) === arc.id;
            const anchoredEvent =
              beat.eventId === null
                ? undefined
                : workspace.plot.storyEvents.find(
                    (event) => event.id === beat.eventId
                  );
            const followsMovedEvent =
              anchoredEvent?.arcIds.includes(arc.id) === true &&
              beat.volumeId === sourceVolumeId &&
              !anchoredEvent.arcIds.some((eventArcId) => {
                const eventArc = workspace.plot.arcs.find(
                  (candidate) => candidate.id === eventArcId
                );
                return eventArc?.volumeId === sourceVolumeId;
              });
            if (
              (!followsMovedArc && !followsMovedEvent) ||
              (beat.volumeId ?? null) === null
            ) {
              return;
            }
            assertBeatIsMutable(beat, "move with its planning arc");
            const concreteChapterId = concreteChapterIdForBeat(workspace, beat);
            beat.volumeId =
              followsMovedEvent && concreteChapterId !== null
                ? null
                : followsMovedArc && concreteChapterId !== null
                  ? null
                  : operation.toVolumeId;
            markUpdated(state, beat.id);
          });
        });
      }
      const target = workspace.plot.arcs
        .filter(({ volumeId }) => volumeId === operation.toVolumeId)
        .sort((left, right) => left.order - right.order);
      const orderedIds = insertBeforeId(
        target.map(({ id }) => id),
        arc.id,
        operation.beforeArcId,
        "Arc move"
      );
      updateOrdersById(
        target,
        orderedIds,
        (value, order) => {
          value.order = order;
        },
        state
      );
      markUpdated(state, arc.id);
      break;
    }
    case "arc.reorder": {
      const target = workspace.plot.arcs
        .filter(({ volumeId }) => volumeId === operation.volumeId)
        .sort((left, right) => left.order - right.order);
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Arcs in ${operation.volumeId}`
      );
      updateOrdersById(
        target,
        operation.orderedIds,
        (value, order) => {
          value.order = order;
        },
        state
      );
      break;
    }
    default:
      break;
  }
}
