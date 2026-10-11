import type {
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  createEmptyLongMarkdownFileReference,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId
} from "@deepwrite/contracts";
import {
  LONG_DOCUMENT_LABELS,
  type LongCharacterDocumentKey
} from "./entity-registry";
import type { LongDocumentTarget } from "./target";

export function resolveCharacterDocument(
  index: LongWorkspaceIndexSnapshot,
  characterId: string,
  document: LongCharacterDocumentKey
): LongDocumentTarget {
  const character = index.characters.find(({ id }) => id === characterId);
  const files = index.characterFiles.find(
    (entry) => entry.characterId === characterId
  );
  if (!character || !files) throw new Error(`人物 ${characterId} 不存在。`);

  let file: LongWorkspaceFileReference;
  let readOnly = false;
  let inlineContent: string | undefined;
  if (document === "core_profile") {
    file = files.coreProfile;
  } else if (document === "relationships") {
    file = files.relationships;
  } else {
    const volumeOrder = new Map(
      index.plot.volumes.map(({ id, order }) => [id, order])
    );
    const chapterOrder = new Map(
      [...index.plot.chapterCards]
        .sort(
          (left, right) =>
            (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
              (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
            left.narrativeOrder - right.narrativeOrder ||
            left.id.localeCompare(right.id)
        )
        .map(({ id }, order) => [id, order])
    );
    const latest = [...index.ledger.commits]
      .sort(
        (left, right) =>
          (chapterOrder.get(right.chapterCardId) ?? -1) -
            (chapterOrder.get(left.chapterCardId) ?? -1) ||
          right.sequence - left.sequence
      )
      .map((commit) =>
        index.chapters.find(
          (chapter) =>
            chapter.chapterCardId === commit.chapterCardId &&
            chapter.commitId === commit.id
        )
      )
      .find((chapter) =>
        chapter?.characterContinuity.some(
          (entry) => entry.characterId === characterId
        )
      )
      ?.characterContinuity.find((entry) => entry.characterId === characterId);
    readOnly = true;
    if (latest) {
      file =
        document === "current_state" ? latest.currentState : latest.history;
    } else {
      file = createEmptyLongMarkdownFileReference(
        document === "current_state"
          ? longCharacterCurrentStateFileId(characterId)
          : longCharacterHistoryFileId(characterId),
        longCharacterFilePath(
          characterId,
          document === "current_state" ? "current-state.md" : "history.md"
        ),
        index.updatedAt
      );
      inlineContent = "";
    }
  }
  return {
    addressing: "document",
    kind: "character",
    stage: "character",
    id: characterId,
    document,
    characterId,
    characterName: character.name,
    title: `${character.name} / ${LONG_DOCUMENT_LABELS[document]}`,
    file,
    ...(readOnly ? { readOnly: true } : {}),
    ...(inlineContent !== undefined ? { inlineContent } : {})
  };
}
