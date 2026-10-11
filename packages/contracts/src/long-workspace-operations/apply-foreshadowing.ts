import { deriveLongForeshadowingStatusFromCommittedBeats } from "../long-workspace";
import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";

import { deleteForeshadowingBeat, deleteForeshadowingThread } from "./cascade";
import {
  assertBeatIsMutable,
  assertExactOrder,
  assertNewEntityId,
  findBeat,
  findEntityIndex,
  insertBeforeId,
  markCreated,
  markUpdated,
  nextOrder,
  operationError,
  registerProvisionalId
} from "./state";

export function applyForeshadowingOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "foreshadowing.create": {
      assertNewEntityId(
        workspace.plot.foreshadowing,
        operation.thread.id,
        "Foreshadowing thread"
      );
      const existingBeatIds = new Set(
        workspace.plot.foreshadowing.flatMap(({ beats }) =>
          beats.map(({ id }) => id)
        )
      );
      operation.thread.beats.forEach((beat) => {
        if (existingBeatIds.has(beat.id)) {
          operationError(
            "already_exists",
            `Foreshadowing beat ${beat.id} already exists.`
          );
        }
        if (beat.status !== "planned" || beat.commitId !== null) {
          operationError(
            "invalid_reference",
            "New foreshadowing beats must start in planned state."
          );
        }
        existingBeatIds.add(beat.id);
      });
      if (operation.thread.status !== "planned") {
        operationError(
          "invalid_reference",
          "New foreshadowing threads must start in planned state."
        );
      }
      workspace.plot.foreshadowing.push(structuredClone(operation.thread));
      markCreated(state, operation.thread.id);
      operation.thread.beats.forEach((beat) => markCreated(state, beat.id));
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.thread.id
      );
      break;
    }
    case "foreshadowing.update": {
      const thread =
        workspace.plot.foreshadowing[
          findEntityIndex(
            workspace.plot.foreshadowing,
            operation.id,
            "Foreshadowing thread"
          )
        ]!;
      Object.assign(thread, operation.patch);
      if (operation.patch.status === "planned") {
        thread.status = deriveLongForeshadowingStatusFromCommittedBeats(
          thread.beats
        );
      }
      markUpdated(state, thread.id);
      break;
    }
    case "foreshadowing.delete": {
      deleteForeshadowingThread(state, operation.id);
      break;
    }
    case "foreshadowing.reorder": {
      assertExactOrder(
        workspace.plot.foreshadowing.map(({ id }) => id),
        operation.orderedIds,
        "Foreshadowing thread"
      );
      const byId = new Map(
        workspace.plot.foreshadowing.map((thread) => [thread.id, thread])
      );
      workspace.plot.foreshadowing = operation.orderedIds.map((id: string) => {
        const thread = byId.get(id);
        if (!thread) {
          return operationError(
            "not_found",
            `Foreshadowing thread ${id} does not exist.`
          );
        }
        markUpdated(state, id);
        return thread;
      });
      break;
    }

    case "foreshadowingBeat.create": {
      const thread =
        workspace.plot.foreshadowing[
          findEntityIndex(
            workspace.plot.foreshadowing,
            operation.threadId,
            "Foreshadowing thread"
          )
        ]!;
      const existingBeatIds = new Set(
        workspace.plot.foreshadowing.flatMap(({ beats }) =>
          beats.map(({ id }) => id)
        )
      );
      if (existingBeatIds.has(operation.beat.id)) {
        operationError(
          "already_exists",
          `Foreshadowing beat ${operation.beat.id} already exists.`
        );
      }
      if (
        operation.beat.status !== "planned" ||
        operation.beat.commitId !== null
      ) {
        operationError(
          "invalid_reference",
          "New foreshadowing beats must start in planned state."
        );
      }
      const beat = structuredClone(operation.beat);
      beat.order = nextOrder(thread.beats.map(({ order }) => order));
      thread.beats.push(beat);
      markCreated(state, operation.beat.id);
      markUpdated(state, thread.id);
      registerProvisionalId(state, operation.provisionalId, operation.beat.id);
      break;
    }
    case "foreshadowingBeat.update": {
      const { beat } = findBeat(workspace, operation.id);
      assertBeatIsMutable(beat, "update");
      Object.assign(beat, operation.patch);
      markUpdated(state, beat.id);
      break;
    }
    case "foreshadowingBeat.delete": {
      deleteForeshadowingBeat(state, operation.id);
      break;
    }
    case "foreshadowingBeat.move": {
      const located = findBeat(workspace, operation.id);
      assertBeatIsMutable(located.beat, "move");
      const targetThread =
        workspace.plot.foreshadowing[
          findEntityIndex(
            workspace.plot.foreshadowing,
            operation.toThreadId,
            "Target foreshadowing thread"
          )
        ]!;
      located.thread.beats.splice(located.beatIndex, 1);
      const ids = insertBeforeId(
        targetThread.beats
          .sort((left, right) => left.order - right.order)
          .map(({ id }) => id),
        located.beat.id,
        operation.beforeBeatId,
        "Foreshadowing beat move"
      );
      const beatById = new Map(
        [...targetThread.beats, located.beat].map((beat) => [beat.id, beat])
      );
      targetThread.beats = ids.map((id, index) => {
        const beat = beatById.get(id);
        if (!beat) {
          return operationError(
            "not_found",
            `Foreshadowing beat ${id} does not exist.`
          );
        }
        beat.order = index + 1;
        return beat;
      });
      markUpdated(state, located.thread.id);
      markUpdated(state, targetThread.id);
      markUpdated(state, located.beat.id);
      break;
    }
    case "foreshadowingBeat.reorder": {
      const thread =
        workspace.plot.foreshadowing[
          findEntityIndex(
            workspace.plot.foreshadowing,
            operation.threadId,
            "Foreshadowing thread"
          )
        ]!;
      assertExactOrder(
        thread.beats.map(({ id }) => id),
        operation.orderedIds,
        `Foreshadowing beats in ${thread.id}`
      );
      const beatById = new Map(thread.beats.map((beat) => [beat.id, beat]));
      thread.beats = operation.orderedIds.map((id: string, index: number) => {
        const beat = beatById.get(id);
        if (!beat) {
          return operationError(
            "not_found",
            `Foreshadowing beat ${id} does not exist.`
          );
        }
        beat.order = index + 1;
        markUpdated(state, beat.id);
        return beat;
      });
      markUpdated(state, thread.id);
      break;
    }
    default:
      break;
  }
}
