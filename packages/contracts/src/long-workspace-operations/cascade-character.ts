import { cleanupProjectionForDeletedEntity } from "./ledger-cleanup";
import type { MutationState } from "./state";
import {
  addFileDeleteIntent,
  findEntityIndex,
  markDeleted,
  markUpdated,
  operationError
} from "./state";

export function deleteCharacter(
  state: MutationState,
  characterId: string
): void {
  const characterIndex = findEntityIndex(
    state.draft.characters,
    characterId,
    "Character"
  );
  const character = state.draft.characters[characterIndex]!;
  const continuityRefs = state.draft.chapters.flatMap((chapter) =>
    chapter.characterContinuity
      .filter((entry) => entry.characterId === characterId)
      .map((entry) => ({ chapter, entry }))
  );
  state.draft.plot.storyEvents.forEach((event) => {
    if (!event.characterIds.includes(characterId)) return;
    event.characterIds = event.characterIds.filter(
      (candidate) => candidate !== characterId
    );
    markUpdated(state, event.id);
  });
  for (const { chapter, entry } of continuityRefs) {
    [entry.currentState, entry.history].forEach((file) =>
      addFileDeleteIntent(
        state,
        file,
        `Delete chapter continuity for character ${characterId}`
      )
    );
    chapter.characterContinuity = chapter.characterContinuity.filter(
      (candidate) => candidate.characterId !== characterId
    );
    markUpdated(state, chapter.chapterCardId);
  }

  const fileIndex = state.draft.characterFiles.findIndex(
    (entry) => entry.characterId === characterId
  );
  if (fileIndex < 0) {
    operationError(
      "invalid_result",
      `Character ${characterId} is missing its file index.`
    );
  }
  const files = state.draft.characterFiles[fileIndex]!;
  [files.coreProfile, files.relationships].forEach((file) =>
    addFileDeleteIntent(state, file, `Delete character ${characterId}`)
  );
  cleanupProjectionForDeletedEntity(state, character.id, {
    characterAudience: true
  });
  state.draft.characterFiles.splice(fileIndex, 1);
  state.draft.characters.splice(characterIndex, 1);
  markDeleted(state, character.id);
}
