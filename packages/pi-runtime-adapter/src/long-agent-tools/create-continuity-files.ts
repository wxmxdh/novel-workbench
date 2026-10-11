import {
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterContinuityFilePath,
  longChapterWorldRevealsFileId,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  createChange,
  newLongFile,
  requireMeta,
  type LongCreateInput,
  type LongCreateResult
} from "./create-support";
import type { LongDocumentTarget } from "./target";

type ContinuityDocument =
  | "world_reveals"
  | "continuity_character_current_state"
  | "continuity_character_history";

type CharacterContinuityDocument = "current_state" | "history";

function requireChapter(
  index: LongWorkspaceIndexSnapshot,
  chapterCardId: string
) {
  const chapter = index.chapters.find(
    (entry) => entry.chapterCardId === chapterCardId
  );
  const card = index.plot.chapterCards.find(({ id }) => id === chapterCardId);
  if (!chapter || !card) throw new Error(`章卡 ${chapterCardId} 不存在。`);
  if (chapter.commitId !== null) {
    throw new Error(`章卡 ${chapterCardId} 已提交账本，不能再创建连续性文件。`);
  }
  return { chapter, card };
}

function continuityTarget(
  chapterCardId: string,
  chapterTitle: string,
  document: ContinuityDocument,
  file: LongWorkspaceFileReference,
  label: string,
  character?: { id: string; name: string }
): LongDocumentTarget {
  return {
    addressing: "document",
    kind: "chapter_card",
    stage: "continuity",
    id: chapterCardId,
    document,
    ...(character
      ? { characterId: character.id, characterName: character.name }
      : {}),
    chapterTitle,
    title: `${chapterTitle} / ${label}`,
    file
  };
}

function createWorldReveals(input: LongCreateInput): LongCreateResult {
  const chapterCardId = requireMeta(
    input.meta.chapter_card_id ?? input.activeChapterCardId,
    "chapter_card_id"
  );
  if (input.meta.document) {
    throw new Error("continuity_world_reveals 不接受 meta.document。");
  }
  const { chapter, card } = requireChapter(input.index, chapterCardId);
  const targetFor = (file: LongWorkspaceFileReference) =>
    continuityTarget(
      chapterCardId,
      card.title,
      "world_reveals",
      file,
      "世界观揭露"
    );
  if (chapter.worldReveals) {
    throw new Error("本章已有世界观揭露文件，请用 edit 写入或修改。");
  }
  const file = newLongFile(
    longChapterWorldRevealsFileId(chapterCardId),
    longChapterContinuityFilePath(chapterCardId, "world-reveals.md"),
    input.timestamp,
    input.content
  );
  return {
    operations: [
      { type: "chapterContinuity.worldReveals.create", chapterCardId, file }
    ],
    changes: [createChange(targetFor(file), file, input.content)],
    createdId: chapterCardId,
    label: `《${card.title}》世界观揭露`
  };
}

function createCharacterContinuity(input: LongCreateInput): LongCreateResult {
  const chapterCardId = requireMeta(
    input.meta.chapter_card_id ?? input.activeChapterCardId,
    "chapter_card_id"
  );
  const document = input.meta.document;
  if (document !== "current_state" && document !== "history") {
    throw new Error(
      "创建人物连续性文件必须提供 meta.document=current_state 或 history，content 写入该文档。"
    );
  }
  const { chapter, card } = requireChapter(input.index, chapterCardId);
  const characterId = requireMeta(input.meta.character_id, "character_id");
  const character = input.index.characters.find(({ id }) => id === characterId);
  if (!character) throw new Error(`人物 ${characterId} 不存在。`);
  const identity = { id: characterId, name: character.name };
  const targetFor = (
    file: LongWorkspaceFileReference,
    kind: CharacterContinuityDocument
  ) =>
    continuityTarget(
      chapterCardId,
      card.title,
      kind === "current_state"
        ? "continuity_character_current_state"
        : "continuity_character_history",
      file,
      kind === "current_state"
        ? `${character.name} / 人物当前状态`
        : `${character.name} / 人物历史轨迹`,
      identity
    );

  const existing = chapter.characterContinuity.find(
    (entry) => entry.characterId === characterId
  );
  if (existing) {
    throw new Error(
      `本章已有该人物的连续性文件，请用 edit 写入或修改${
        document === "current_state" ? "当前状态" : "历史轨迹"
      }。`
    );
  }

  const currentContent = document === "current_state" ? input.content : "";
  const historyContent = document === "history" ? input.content : "";
  const currentState = newLongFile(
    longChapterCharacterCurrentStateFileId(chapterCardId, characterId),
    longChapterCharacterContinuityFilePath(
      chapterCardId,
      characterId,
      "current-state.md"
    ),
    input.timestamp,
    currentContent
  );
  const history = newLongFile(
    longChapterCharacterHistoryFileId(chapterCardId, characterId),
    longChapterCharacterContinuityFilePath(
      chapterCardId,
      characterId,
      "history.md"
    ),
    input.timestamp,
    historyContent
  );
  return {
    operations: [
      {
        type: "chapterContinuity.character.create",
        chapterCardId,
        characterId,
        currentState,
        history
      }
    ],
    changes: [
      createChange(
        targetFor(currentState, "current_state"),
        currentState,
        currentContent
      ),
      createChange(targetFor(history, "history"), history, historyContent)
    ],
    createdId: chapterCardId,
    label: `《${card.title}》中${character.name}的${
      document === "current_state" ? "人物当前状态" : "人物历史轨迹"
    }`
  };
}

export function createContinuityFiles(
  input: LongCreateInput
): LongCreateResult {
  if (input.kind === "continuity_world_reveals") {
    return createWorldReveals(input);
  }
  return createCharacterContinuity(input);
}
