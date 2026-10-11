import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";
import {
  addFileCreateIntent,
  addFileDeleteIntent,
  assertChapterContinuityIsMutable,
  ensureFilesAvailable,
  findEntityIndex,
  operationError
} from "./state";

function chapterFiles(state: MutationState, chapterCardId: string) {
  const entries = state.draft.chapters;
  return entries[
    findEntityIndex(
      entries.map((entry) => ({ ...entry, id: entry.chapterCardId })),
      chapterCardId,
      "Chapter file index"
    )
  ]!;
}

export function applyChapterContinuityOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "chapterContinuity.worldReveals.create": {
      assertChapterContinuityIsMutable(
        workspace,
        operation.chapterCardId,
        "create world-reveals continuity for"
      );
      const files = chapterFiles(state, operation.chapterCardId);
      if (files.worldReveals) {
        operationError(
          "already_exists",
          `Chapter ${operation.chapterCardId} already has a world-reveals file.`
        );
      }
      ensureFilesAvailable(state, [operation.file]);
      files.worldReveals = structuredClone(operation.file);
      addFileCreateIntent(
        state,
        operation.file,
        `Create world reveals for chapter ${operation.chapterCardId}`
      );
      break;
    }
    case "chapterContinuity.worldReveals.delete": {
      assertChapterContinuityIsMutable(
        workspace,
        operation.chapterCardId,
        "delete world-reveals continuity from"
      );
      const files = chapterFiles(state, operation.chapterCardId);
      if (!files.worldReveals) {
        operationError(
          "not_found",
          `Chapter ${operation.chapterCardId} does not have a world-reveals file.`
        );
      }
      addFileDeleteIntent(
        state,
        files.worldReveals,
        `Delete world reveals from chapter ${operation.chapterCardId}`
      );
      files.worldReveals = null;
      break;
    }
    case "chapterContinuity.character.create": {
      assertChapterContinuityIsMutable(
        workspace,
        operation.chapterCardId,
        "create character continuity for"
      );
      findEntityIndex(workspace.characters, operation.characterId, "Character");
      const chapter = chapterFiles(state, operation.chapterCardId);
      if (
        chapter.characterContinuity.some(
          ({ characterId }) => characterId === operation.characterId
        )
      ) {
        operationError(
          "already_exists",
          `Chapter ${operation.chapterCardId} already tracks character ${operation.characterId}.`
        );
      }
      const files = [operation.currentState, operation.history];
      ensureFilesAvailable(state, files);
      chapter.characterContinuity.push({
        characterId: operation.characterId,
        currentState: structuredClone(operation.currentState),
        history: structuredClone(operation.history)
      });
      files.forEach((file) =>
        addFileCreateIntent(
          state,
          file,
          `Create character continuity for ${operation.characterId} in chapter ${operation.chapterCardId}`
        )
      );
      break;
    }
    case "chapterContinuity.character.delete": {
      assertChapterContinuityIsMutable(
        workspace,
        operation.chapterCardId,
        "delete character continuity from"
      );
      const chapter = chapterFiles(state, operation.chapterCardId);
      const continuityIndex = chapter.characterContinuity.findIndex(
        ({ characterId }) => characterId === operation.characterId
      );
      if (continuityIndex < 0) {
        operationError(
          "not_found",
          `Chapter ${operation.chapterCardId} does not track character ${operation.characterId}.`
        );
      }
      const [continuity] = chapter.characterContinuity.splice(
        continuityIndex,
        1
      );
      [continuity!.currentState, continuity!.history].forEach((file) =>
        addFileDeleteIntent(
          state,
          file,
          `Delete character continuity for ${operation.characterId} from chapter ${operation.chapterCardId}`
        )
      );
      break;
    }
    default:
      break;
  }
}
