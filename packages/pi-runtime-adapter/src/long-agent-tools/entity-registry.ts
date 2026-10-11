import type { LongWorkspaceRoot } from "@deepwrite/contracts";

/**
 * Single source of truth for how the unified long-form tools address content.
 * Every entity is reachable by its stable business id; the id prefix decides
 * the entity kind, and only characters and chapter cards need a second
 * `document` dimension.
 */

export const LONG_STAGES = [
  "worldbuilding",
  "character",
  "plot",
  "draft",
  "continuity"
] as const;
export type LongStage = (typeof LONG_STAGES)[number];

export const LONG_STAGE_LABELS: Record<LongStage, string> = {
  worldbuilding: "世界观",
  character: "人物",
  plot: "剧情",
  draft: "正文",
  continuity: "连续性"
};

export const LONG_STAGE_ROOTS: Record<LongStage, LongWorkspaceRoot> = {
  worldbuilding: "worldbuilding",
  character: "character_design",
  plot: "plot_design",
  draft: "draft",
  continuity: "continuity_ledger"
};

export const LONG_ENTITY_KINDS = [
  "worldbuilding_category",
  "worldbuilding_item",
  "character",
  "character_overview",
  "book_line",
  "volume",
  "arc",
  "story_plot",
  "chapter_card",
  "story_event",
  "event_connection",
  "narrative_placement",
  "foreshadowing",
  "foreshadowing_beat"
] as const;
export type LongEntityKind = (typeof LONG_ENTITY_KINDS)[number];

/** Fixed singletons are matched before prefix parsing. */
export const LONG_BOOK_LINE_ID = "book_line" as const;
export const LONG_CHARACTER_OVERVIEW_ID = "character_overview" as const;

const ID_PREFIX_TO_KIND: Readonly<Record<string, LongEntityKind>> = {
  world: "worldbuilding_category",
  worlditem: "worldbuilding_item",
  character: "character",
  volume: "volume",
  arc: "arc",
  storyplot: "story_plot",
  chapter: "chapter_card",
  event: "story_event",
  connection: "event_connection",
  placement: "narrative_placement",
  foreshadow: "foreshadowing",
  beat: "foreshadowing_beat"
};

export const LONG_ENTITY_KIND_LABELS: Record<LongEntityKind, string> = {
  worldbuilding_category: "世界观分类",
  worldbuilding_item: "世界观条目",
  character: "人物",
  character_overview: "人物概览",
  book_line: "全书故事线",
  volume: "分卷",
  arc: "剧情点",
  story_plot: "故事情节",
  chapter_card: "章卡",
  story_event: "故事事件",
  event_connection: "事件连接",
  narrative_placement: "叙事落点",
  foreshadowing: "伏笔线",
  foreshadowing_beat: "伏笔触点"
};

/** State/history map to the latest committed chapter unless a chapter is given. */
export const LONG_CHARACTER_DOCUMENTS = [
  "core_profile",
  "relationships",
  "current_state",
  "history"
] as const;
export type LongCharacterDocumentKey =
  (typeof LONG_CHARACTER_DOCUMENTS)[number];

/** Documents addressed directly through a chapter-card id. */
export const LONG_DIRECT_CHAPTER_DOCUMENTS = [
  "card",
  "body",
  "character_state",
  "handoff",
  "foreshadowing_changes",
  "world_reveals"
] as const;

/** Internal storage roles for a character document scoped to one chapter. */
export const LONG_CHAPTER_CHARACTER_DOCUMENTS = [
  "continuity_character_current_state",
  "continuity_character_history"
] as const;

/** Chapter cards span the plot, draft and continuity stages. */
export const LONG_CHAPTER_DOCUMENTS = [
  ...LONG_DIRECT_CHAPTER_DOCUMENTS,
  ...LONG_CHAPTER_CHARACTER_DOCUMENTS
] as const;
export type LongChapterDocumentKey = (typeof LONG_CHAPTER_DOCUMENTS)[number];

/** Document names exposed by read/edit/delete. Storage-only roles stay hidden. */
export const LONG_TOOL_DOCUMENTS = [
  ...LONG_CHARACTER_DOCUMENTS,
  ...LONG_DIRECT_CHAPTER_DOCUMENTS
] as const;

export const LONG_DOCUMENT_KEYS = [
  ...LONG_CHARACTER_DOCUMENTS,
  ...LONG_CHAPTER_DOCUMENTS
] as const;
export type LongDocumentKey = (typeof LONG_DOCUMENT_KEYS)[number];

export const LONG_DOCUMENT_LABELS: Record<LongDocumentKey, string> = {
  core_profile: "核心档案",
  relationships: "人物关系",
  current_state: "当前状态",
  history: "历史轨迹",
  card: "章卡",
  body: "小说正文",
  character_state: "章末状态",
  handoff: "接续包",
  foreshadowing_changes: "伏笔变化",
  world_reveals: "世界观揭露",
  continuity_character_current_state: "人物当前状态",
  continuity_character_history: "人物历史轨迹"
};

const CHAPTER_DOCUMENT_STAGES: Record<LongChapterDocumentKey, LongStage> = {
  card: "plot",
  body: "draft",
  character_state: "continuity",
  handoff: "continuity",
  foreshadowing_changes: "continuity",
  world_reveals: "continuity",
  continuity_character_current_state: "continuity",
  continuity_character_history: "continuity"
};

const ENTITY_KIND_STAGES: Record<LongEntityKind, LongStage> = {
  worldbuilding_category: "worldbuilding",
  worldbuilding_item: "worldbuilding",
  character: "character",
  character_overview: "character",
  book_line: "plot",
  volume: "plot",
  arc: "plot",
  story_plot: "plot",
  chapter_card: "plot",
  story_event: "plot",
  event_connection: "plot",
  narrative_placement: "plot",
  foreshadowing: "plot",
  foreshadowing_beat: "plot"
};

export function longEntityKindForId(id: string): LongEntityKind | undefined {
  if (id === LONG_BOOK_LINE_ID) return "book_line";
  if (id === LONG_CHARACTER_OVERVIEW_ID) return "character_overview";
  const separator = id.indexOf("_");
  if (separator <= 0 || separator === id.length - 1) return undefined;
  return ID_PREFIX_TO_KIND[id.slice(0, separator)];
}

export function longStageForTarget(
  kind: LongEntityKind,
  document?: LongDocumentKey
): LongStage {
  if (kind === "chapter_card" && document) {
    return CHAPTER_DOCUMENT_STAGES[document as LongChapterDocumentKey];
  }
  return ENTITY_KIND_STAGES[kind];
}

/** Kinds that own several documents and therefore require `document`. */
export function longDocumentKeysForKind(
  kind: LongEntityKind
): readonly LongDocumentKey[] {
  if (kind === "character") return LONG_CHARACTER_DOCUMENTS;
  if (kind === "chapter_card") return LONG_CHAPTER_DOCUMENTS;
  return [];
}

export const LONG_CREATE_KINDS = [
  "worldbuilding_item",
  "character",
  "volume",
  "arc",
  "story_plot",
  "chapter_card",
  "story_event",
  "event_connection",
  "narrative_placement",
  "foreshadowing",
  "foreshadowing_beat",
  "continuity_world_reveals",
  "continuity_character"
] as const;
export type LongCreateKind = (typeof LONG_CREATE_KINDS)[number];

/**
 * Container structures (worldbuilding categories, character types) stay under
 * the UI's own structure editor, so the agent may only address their content.
 */
export const LONG_DELETABLE_KINDS: ReadonlySet<LongEntityKind> = new Set([
  "worldbuilding_item",
  "character",
  "volume",
  "arc",
  "story_plot",
  "chapter_card",
  "story_event",
  "event_connection",
  "narrative_placement",
  "foreshadowing",
  "foreshadowing_beat"
]);
