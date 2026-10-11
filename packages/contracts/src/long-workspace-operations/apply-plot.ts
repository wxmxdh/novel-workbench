import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";

import {
  deleteNarrativePlacement,
  deleteStoryEvent,
  deleteStoryPlot
} from "./cascade";
import { cleanupProjectionForDeletedEntity } from "./ledger-cleanup";
import {
  addFileCreateIntent,
  assertBeatIsMutable,
  assertChapterIsMutable,
  assertExactOrder,
  assertNewEntityId,
  assertPlacementIsMutable,
  concreteChapterIdForBeat,
  ensureFilesAvailable,
  findEntityIndex,
  insertBeforeId,
  markCreated,
  markDeleted,
  markUpdated,
  operationError,
  registerProvisionalId,
  retargetBeatPlanningAnchorsToChapter,
  updateOrdersById,
  nextOrder
} from "./state";

export function applyPlotOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "event.create": {
      assertNewEntityId(
        workspace.plot.storyEvents,
        operation.event.id,
        "Story event"
      );
      const event = structuredClone(operation.event);
      event.storyOrder = nextOrder(
        workspace.plot.storyEvents.map(({ storyOrder }) => storyOrder)
      );
      workspace.plot.storyEvents.push(event);
      markCreated(state, operation.event.id);
      registerProvisionalId(state, operation.provisionalId, operation.event.id);
      break;
    }
    case "event.update": {
      const event =
        workspace.plot.storyEvents[
          findEntityIndex(
            workspace.plot.storyEvents,
            operation.id,
            "Story event"
          )
        ]!;
      Object.assign(event, operation.patch);
      if (operation.patch.arcIds !== undefined) {
        const eventVolumeIds = [
          ...new Set(
            event.arcIds
              .map(
                (eventArcId) =>
                  workspace.plot.arcs.find(
                    (candidate) => candidate.id === eventArcId
                  )?.volumeId
              )
              .filter((volumeId): volumeId is string => Boolean(volumeId))
          )
        ];
        workspace.plot.foreshadowing.forEach((thread) => {
          thread.beats.forEach((beat) => {
            if (beat.eventId !== event.id) return;
            const plannedArcId = beat.arcId ?? null;
            const plannedVolumeId = beat.volumeId ?? null;
            const arcNeedsRetarget =
              plannedArcId !== null && !event.arcIds.includes(plannedArcId);
            const volumeNeedsRetarget =
              plannedVolumeId !== null &&
              !eventVolumeIds.includes(plannedVolumeId);
            if (!arcNeedsRetarget && !volumeNeedsRetarget) return;

            assertBeatIsMutable(beat, "retarget with its event");
            const concreteChapterId = concreteChapterIdForBeat(workspace, beat);
            const concreteChapter =
              concreteChapterId === null
                ? undefined
                : workspace.plot.chapterCards.find(
                    (chapter) => chapter.id === concreteChapterId
                  );
            if (arcNeedsRetarget) {
              beat.arcId =
                concreteChapter &&
                concreteChapter.primaryArcId !== null &&
                event.arcIds.includes(concreteChapter.primaryArcId)
                  ? concreteChapter.primaryArcId
                  : !concreteChapter && event.arcIds.length === 1
                    ? event.arcIds[0]!
                    : null;
            }
            if (volumeNeedsRetarget) {
              beat.volumeId =
                concreteChapter &&
                eventVolumeIds.includes(concreteChapter.volumeId)
                  ? concreteChapter.volumeId
                  : !concreteChapter && eventVolumeIds.length === 1
                    ? eventVolumeIds[0]!
                    : null;
            }
            markUpdated(state, beat.id);
          });
        });
      }
      markUpdated(state, event.id);
      break;
    }
    case "event.delete": {
      deleteStoryEvent(state, operation.id);
      break;
    }
    case "event.reorder": {
      assertExactOrder(
        workspace.plot.storyEvents.map(({ id }) => id),
        operation.orderedIds,
        "Story event"
      );
      updateOrdersById(
        workspace.plot.storyEvents,
        operation.orderedIds,
        (event, order) => {
          event.storyOrder = order;
        },
        state
      );
      break;
    }

    case "storyPlot.create": {
      findEntityIndex(workspace.plot.arcs, operation.storyPlot.arcId, "Arc");
      assertNewEntityId(
        workspace.plot.storyPlots,
        operation.storyPlot.id,
        "Story plot"
      );
      ensureFilesAvailable(state, [operation.storyPlot.file]);
      const storyPlot = structuredClone(operation.storyPlot);
      storyPlot.order = nextOrder(
        workspace.plot.storyPlots
          .filter((candidate) => candidate.arcId === storyPlot.arcId)
          .map(({ order }) => order)
      );
      workspace.plot.storyPlots.push(storyPlot);
      addFileCreateIntent(
        state,
        operation.storyPlot.file,
        `Create story plot ${operation.storyPlot.id}`
      );
      markCreated(state, operation.storyPlot.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.storyPlot.id
      );
      break;
    }
    case "storyPlot.update": {
      const storyPlot =
        workspace.plot.storyPlots[
          findEntityIndex(workspace.plot.storyPlots, operation.id, "Story plot")
        ]!;
      Object.assign(storyPlot, operation.patch);
      markUpdated(state, storyPlot.id);
      break;
    }
    case "storyPlot.delete": {
      deleteStoryPlot(state, operation.id);
      break;
    }
    case "storyPlot.reorder": {
      findEntityIndex(workspace.plot.arcs, operation.arcId, "Arc");
      const target = workspace.plot.storyPlots.filter(
        (storyPlot) => storyPlot.arcId === operation.arcId
      );
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Story plots in ${operation.arcId}`
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

    case "connection.create": {
      assertNewEntityId(
        workspace.plot.eventConnections,
        operation.connection.id,
        "Event connection"
      );
      workspace.plot.eventConnections.push(
        structuredClone(operation.connection)
      );
      markCreated(state, operation.connection.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.connection.id
      );
      break;
    }
    case "connection.update": {
      const connection =
        workspace.plot.eventConnections[
          findEntityIndex(
            workspace.plot.eventConnections,
            operation.id,
            "Event connection"
          )
        ]!;
      Object.assign(connection, operation.patch);
      markUpdated(state, connection.id);
      break;
    }
    case "connection.delete": {
      const index = findEntityIndex(
        workspace.plot.eventConnections,
        operation.id,
        "Event connection"
      );
      const connection = workspace.plot.eventConnections[index]!;
      cleanupProjectionForDeletedEntity(state, connection.id);
      workspace.plot.eventConnections.splice(index, 1);
      markDeleted(state, connection.id);
      break;
    }

    case "placement.create": {
      assertNewEntityId(
        workspace.plot.narrativePlacements,
        operation.placement.id,
        "Narrative placement"
      );
      if (
        operation.placement.status !== "planned" ||
        operation.placement.commitId !== null
      ) {
        operationError(
          "invalid_reference",
          "New narrative placements must start in planned state."
        );
      }
      const placement = structuredClone(operation.placement);
      placement.orderInChapter = nextOrder(
        workspace.plot.narrativePlacements
          .filter(
            (candidate) => candidate.chapterCardId === placement.chapterCardId
          )
          .map(({ orderInChapter }) => orderInChapter)
      );
      workspace.plot.narrativePlacements.push(placement);
      markCreated(state, operation.placement.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.placement.id
      );
      break;
    }
    case "placement.update": {
      const placement =
        workspace.plot.narrativePlacements[
          findEntityIndex(
            workspace.plot.narrativePlacements,
            operation.id,
            "Narrative placement"
          )
        ]!;
      assertPlacementIsMutable(placement, "update");
      Object.assign(placement, operation.patch);
      markUpdated(state, placement.id);
      break;
    }
    case "placement.delete": {
      deleteNarrativePlacement(state, operation.id);
      break;
    }
    case "placement.move": {
      const placement =
        workspace.plot.narrativePlacements[
          findEntityIndex(
            workspace.plot.narrativePlacements,
            operation.id,
            "Narrative placement"
          )
        ]!;
      assertPlacementIsMutable(placement, "move");
      assertChapterIsMutable(
        workspace,
        operation.toChapterCardId,
        "receive a moved placement"
      );
      const targetChapter =
        workspace.plot.chapterCards[
          findEntityIndex(
            workspace.plot.chapterCards,
            operation.toChapterCardId,
            "Target chapter"
          )
        ]!;
      placement.chapterCardId = operation.toChapterCardId;
      workspace.plot.foreshadowing.forEach((thread) => {
        thread.beats.forEach((beat) => {
          if (beat.placementId !== placement.id) return;
          if (beat.chapterCardId !== null) {
            assertBeatIsMutable(beat, "move with its placement");
            beat.chapterCardId = operation.toChapterCardId;
            markUpdated(state, beat.id);
          }
          retargetBeatPlanningAnchorsToChapter(
            state,
            beat,
            targetChapter,
            "move with its placement"
          );
        });
      });
      const target = workspace.plot.narrativePlacements
        .filter(
          ({ chapterCardId }) => chapterCardId === operation.toChapterCardId
        )
        .sort((left, right) => left.orderInChapter - right.orderInChapter);
      const orderedIds = insertBeforeId(
        target.map(({ id }) => id),
        placement.id,
        operation.beforePlacementId,
        "Placement move"
      );
      updateOrdersById(
        target,
        orderedIds,
        (value, order) => {
          value.orderInChapter = order;
        },
        state
      );
      markUpdated(state, placement.id);
      break;
    }
    case "placement.reorder": {
      const target = workspace.plot.narrativePlacements
        .filter(
          ({ chapterCardId }) => chapterCardId === operation.chapterCardId
        )
        .sort((left, right) => left.orderInChapter - right.orderInChapter);
      target.forEach((placement) =>
        assertPlacementIsMutable(placement, "reorder")
      );
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Placements in ${operation.chapterCardId}`
      );
      updateOrdersById(
        target,
        operation.orderedIds,
        (value, order) => {
          value.orderInChapter = order;
        },
        state
      );
      break;
    }
    default:
      break;
  }
}
