import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { orderedLongChapterCards } from "./chapter-ordering";
import { longEntityKindForId } from "./entity-registry";
import {
  beatTypeLabel,
  bodyStatusLabel,
  characterName,
  countLine,
  executionStatusLabel,
  leafScope,
  listScopeHeader,
  nextReadLine,
  nextStepLine,
  resolvedBeatChapterId,
  unknownScope,
  wrongStage
} from "./list-shared";

function chapterDraftLine(
  index: LongWorkspaceIndexSnapshot,
  chapter: LongWorkspaceIndexSnapshot["plot"]["chapterCards"][number]
): string {
  const files = index.chapters.find(
    ({ chapterCardId }) => chapterCardId === chapter.id
  );
  return `- ${chapter.id} ${chapter.title}（主剧情点：${chapter.primaryArcId ?? "未关联"}；正文：${bodyStatusLabel(files?.bodyStatus ?? "empty")}）`;
}

export function draftScopeLines(
  index: LongWorkspaceIndexSnapshot,
  scopeId: string
): string[] {
  const volume = index.plot.volumes.find(({ id }) => id === scopeId);
  if (volume) {
    const chapters = orderedLongChapterCards(index).filter(
      ({ volumeId }) => volumeId === volume.id
    );
    return [
      listScopeHeader("draft", volume.title, volume.id),
      countLine(chapters.length, "张章卡"),
      ...chapters.map((chapter) => chapterDraftLine(index, chapter)),
      nextReadLine("read(id=<chapter_id>, document=body)")
    ];
  }
  const arc = index.plot.arcs.find(({ id }) => id === scopeId);
  if (arc) {
    const chapters = orderedLongChapterCards(index).filter(
      ({ primaryArcId }) => primaryArcId === arc.id
    );
    return [
      listScopeHeader("draft", arc.title, arc.id),
      countLine(chapters.length, "张主线章卡"),
      ...chapters.map((chapter) => chapterDraftLine(index, chapter)),
      nextReadLine("read(id=<chapter_id>, document=body)")
    ];
  }
  if (index.plot.chapterCards.some(({ id }) => id === scopeId)) {
    leafScope(scopeId, `read(id=${scopeId}, document=body)`);
  }
  const kind = longEntityKindForId(scopeId);
  if (kind === "worldbuilding_category" || kind === "worldbuilding_item") {
    wrongStage(scopeId, "worldbuilding");
  }
  if (kind === "character" || kind === "character_overview") {
    wrongStage(scopeId, "character");
  }
  if (kind === "volume" || kind === "arc" || kind === "chapter_card") {
    unknownScope(scopeId);
  }
  if (kind) wrongStage(scopeId, "plot");
  unknownScope(scopeId);
}

function chapterContinuityLine(
  index: LongWorkspaceIndexSnapshot,
  chapter: LongWorkspaceIndexSnapshot["plot"]["chapterCards"][number]
): string {
  const files = index.chapters.find(
    ({ chapterCardId }) => chapterCardId === chapter.id
  );
  return `- ${chapter.id} ${chapter.title}（正文：${bodyStatusLabel(files?.bodyStatus ?? "empty")}；连续记录：${files?.commitId ? "已提交" : "未提交"}）`;
}

function chapterContinuityScopeLines(
  index: LongWorkspaceIndexSnapshot,
  chapter: LongWorkspaceIndexSnapshot["plot"]["chapterCards"][number]
): string[] {
  const files = index.chapters.find(
    ({ chapterCardId }) => chapterCardId === chapter.id
  );
  if (!files) {
    throw new Error(`章卡 ${chapter.id} 缺少连续性文件索引。`);
  }
  const documents = [
    "character_state 章末人物状态",
    "handoff 下一章接续包",
    "foreshadowing_changes 伏笔变化",
    ...(files.worldReveals ? ["world_reveals 世界观揭露"] : [])
  ];
  const beats = index.plot.foreshadowing.flatMap((thread) =>
    thread.beats
      .filter((beat) => resolvedBeatChapterId(index, beat) === chapter.id)
      .map((beat) => ({ beat, thread }))
  );
  return [
    listScopeHeader("continuity", chapter.title, chapter.id),
    `状态：正文 ${bodyStatusLabel(files.bodyStatus)}；连续记录 ${files.commitId ? "已提交" : "未提交"}。`,
    countLine(documents.length, "份章节连续性文档"),
    ...documents.map((document) => `- ${document}`),
    countLine(files.characterContinuity.length, "名连续性人物"),
    ...files.characterContinuity.map(
      ({ characterId }) =>
        `- ${characterId} ${characterName(index, characterId)}（current_state、history）`
    ),
    countLine(beats.length, "个可核验伏笔触点"),
    ...beats.map(
      ({ beat, thread }) =>
        `- ${beat.id} ${thread.title}（伏笔线：${thread.id}；${beatTypeLabel(beat.type)}；${executionStatusLabel(beat.status)}）`
    ),
    nextReadLine(`read(id=${chapter.id}, document=<连续性文档>)`)
  ];
}

export function continuityScopeLines(
  index: LongWorkspaceIndexSnapshot,
  scopeId: string
): string[] {
  const volume = index.plot.volumes.find(({ id }) => id === scopeId);
  if (volume) {
    const chapters = orderedLongChapterCards(index).filter(
      ({ volumeId }) => volumeId === volume.id
    );
    return [
      listScopeHeader("continuity", volume.title, volume.id),
      `当前连续记录位置：${index.ledger.committedThroughChapterId ?? "无"}。`,
      countLine(chapters.length, "张章卡"),
      ...chapters.map((chapter) => chapterContinuityLine(index, chapter)),
      nextStepLine(
        "查看某章连续性使用 list(stage=continuity, scope_id=<chapter_id>)；不要对 arc_ 使用 continuity"
      )
    ];
  }
  const chapter = index.plot.chapterCards.find(({ id }) => id === scopeId);
  if (chapter) return chapterContinuityScopeLines(index, chapter);

  const character = index.characters.find(({ id }) => id === scopeId);
  if (character) {
    const chapterIds = new Set(
      index.chapters
        .filter(({ characterContinuity }) =>
          characterContinuity.some(
            ({ characterId }) => characterId === character.id
          )
        )
        .map(({ chapterCardId }) => chapterCardId)
    );
    const chapters = orderedLongChapterCards(index).filter(({ id }) =>
      chapterIds.has(id)
    );
    return [
      listScopeHeader("continuity", character.name, character.id),
      countLine(chapters.length, "章人物连续性记录"),
      ...chapters.map((chapter) => chapterContinuityLine(index, chapter)),
      nextReadLine(
        "read(id=<人物 id>, document=current_state|history, chapter_id=<chapter_id>)"
      )
    ];
  }

  const kind = longEntityKindForId(scopeId);
  if (kind === "worldbuilding_category" || kind === "worldbuilding_item") {
    wrongStage(scopeId, "worldbuilding");
  }
  if (kind === "character_overview") wrongStage(scopeId, "character");
  if (kind === "volume" || kind === "chapter_card" || kind === "character") {
    unknownScope(scopeId);
  }
  if (kind) {
    wrongStage(
      scopeId,
      "plot",
      "连续性只接受 volume_*、chapter_* 或 character_*"
    );
  }
  unknownScope(scopeId);
}
