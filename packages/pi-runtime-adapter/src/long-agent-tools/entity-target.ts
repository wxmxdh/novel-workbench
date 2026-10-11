import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import {
  LONG_BOOK_LINE_ID,
  LONG_CHARACTER_OVERVIEW_ID,
  longEntityKindForId,
  longStageForTarget,
  type LongEntityKind,
  type LongStage
} from "./entity-registry";
import { longEntityRecord } from "./entity-records";

/** An entity addressed without any document dimension, used by `delete`. */
export interface LongEntityTarget {
  addressing: "entity";
  kind: LongEntityKind;
  stage: LongStage;
  id: string;
  title: string;
  categoryId?: string;
}

export function resolveLongEntityTarget(
  index: LongWorkspaceIndexSnapshot,
  id: string
): LongEntityTarget {
  const kind = longEntityKindForId(id);
  if (!kind) throw new Error(`无法识别的 id：${id}。`);
  const base = { addressing: "entity" as const, kind, id };

  if (kind === "worldbuilding_category") {
    const category = index.worldbuilding.find(
      (candidate) => candidate.id === id
    );
    if (!category) throw new Error(`世界观分类 ${id} 不存在。`);
    return {
      ...base,
      stage: "worldbuilding",
      title: category.title,
      categoryId: id
    };
  }
  if (kind === "worldbuilding_item") {
    for (const category of index.worldbuilding) {
      if (category.format !== "list") continue;
      const item = category.items.find((candidate) => candidate.id === id);
      if (item) {
        return {
          ...base,
          stage: "worldbuilding",
          title: `${category.title} / ${item.title}`,
          categoryId: category.id
        };
      }
    }
    throw new Error(`世界观条目 ${id} 不存在。`);
  }
  if (kind === "character") {
    const character = index.characters.find((candidate) => candidate.id === id);
    if (!character) throw new Error(`人物 ${id} 不存在。`);
    return { ...base, stage: "character", title: character.name };
  }
  if (kind === "character_overview") {
    return {
      ...base,
      id: LONG_CHARACTER_OVERVIEW_ID,
      stage: "character",
      title: "人物概览"
    };
  }
  if (kind === "book_line") {
    return {
      ...base,
      id: LONG_BOOK_LINE_ID,
      stage: "plot",
      title: "全书故事线"
    };
  }
  if (kind === "chapter_card") {
    const card = index.plot.chapterCards.find(
      (candidate) => candidate.id === id
    );
    if (!card) throw new Error(`章卡 ${id} 不存在。`);
    return { ...base, stage: "plot", title: card.title };
  }
  if (kind === "story_plot") {
    const storyPlot = index.plot.storyPlots.find(
      (candidate) => candidate.id === id
    );
    if (!storyPlot) throw new Error(`故事情节 ${id} 不存在。`);
    return { ...base, stage: "plot", title: storyPlot.title };
  }
  const record = longEntityRecord(index, kind, id);
  return {
    ...base,
    stage: longStageForTarget(kind),
    title: record.title
  };
}
