import { z } from "zod";

import { LongTimestampSchema } from "./primitives";

export const LONG_WORKSPACE_SCHEMA_VERSION = 1 as const;
export const LONG_PROJECT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const LONG_WORKSPACE_INDEX_PATH = "long/index.json" as const;
export const LONG_AGENTS_MD_PATH = "AGENTS.md" as const;
export const LONG_AGENTS_MD_MAX_CHARACTERS = 10_000;

export const DEFAULT_LONG_AGENTS_MD = `# 长篇上下文

本文说明五个阶段各自写什么、根据什么来写。五个阶段由同一个长篇智能体统一维护，可以跨阶段查阅，但每类内容必须写回它自己的阶段。未读取的正文、剧情或设定不得当成事实。发现冲突时先指出，再用最小改动方案；不要默默改掉其他阶段已经确认的内容。持续性账本只供后续参考，不锁定正文、人物资料或剧情结构。

## 写作思路

先定约束，再定书脊，再切成可写的章，最后写正文并记账。不必一次做完，但每写一层都要先读上一层已经确认的内容。用户点名从某一层开始时，同样先读它依赖的上层。

1. 世界观与人物：只写会进入冲突和选择的约束，不写百科。
2. 全书故事线：这本书的命题、主线目标、核心冲突、因果脊骨、关键转折和结局承诺。
3. 卷纲：把书脊切成各卷任务，写清本卷起止状态、必须完成的冲突、必须种下或回收的东西。
4. 剧情点：本卷里的大发展脉络。故事情节把脉络拆成可执行场景链；故事事件写真正发生了什么。
5. 伏笔：先写隐藏真相和读者会追问的问题，再排触点；触点先锚到卷或剧情点，再落到章。
6. 章卡：把本卷叙事切成可写的一章一章，写本章任务而不是小说正文。
7. 正文：只写当前章的小说正文。
8. 账本：可以按一章提交，也可以把连续写完的多章作为一个批次提交。批次读取全部正文，只在末章汇总章末状态、下一章接续包和人物发展状态。

## 世界观阶段

维护规则、势力、地理、历史、术语、境界、物品等设定。只写会约束人物选择、冲突推进或信息边界的内容。

文本型分类以分类本身为正文。列表型分类拆成概览和条目：概览是该类的地图，条目是完整设定。分类本身由用户在结构管理中维护；智能体只新增或修改列表条目与正文。

建立规则：

- 根据：故事需要什么样的硬约束，人物会因什么被逼到选择。
- 条目写：这条规则是什么、约束谁、违反会怎样、会逼出什么冲突；不要写剧情过程。
- 新建或改写一条规则后，必须同步改该分类概览。概览保持「有哪些规则、彼此关系、哪条是硬约束」的地图，不要把条目全文抄进去。

其他列表分类同理。势力写立场、资源、与其他势力的张力；地理写会进入情节的空间与通行限制；历史、术语、境界、物品只写后续会用到的部分。改条目后同步改概览。可对照全书结构与人物查冲突，但不修改剧情结构和章节正文。

## 人物阶段

维护人物概览、核心档案和人物关系。当前状态与历史轨迹只读映射最新已提交章节的连续性文件，没有记录时为空。人物类型由用户在结构管理中维护；智能体只新增或修改具体人物。

建立人物按这个顺序：

1. 概览：姓名、类型、别名、一句话定位。它是索引，不要塞完整人设或剧情原文。
2. 核心档案：根据故事功能和世界约束来写。至少包括身份与处境；核心欲望、恐惧、缺陷、秘密和底线；遇选择时怎么做；辨识度（语言、行为、价值判断）；人物弧的起点。不要把尚未发生的剧情写成既成事实。
3. 人物关系：根据已有人物来写。写清与谁之间的利益、情感、误解、控制，以及关系还能怎么变。点名具体人物，不要写空泛标签。
4. 当前状态和历史轨迹：不在人物阶段手写。等正文提交账本后，从连续性记录映射过来。

新建或调整人物后必须同步改概览。可结合世界观与剧情框架查冲突，人物内容仍以人物文档为准。

## 剧情点阶段

维护全书故事线、分卷、剧情点、故事情节、章卡、故事事件、事件连接、叙事落点与伏笔。世界观与人物只读，用来设计剧情或检查结构冲突。

全书故事线：

- 根据：题材、已确认的世界硬约束、主角欲望与缺陷。
- 写：这本书在讲什么、主角要什么、最大阻力是什么、因果脊骨、关键转折、结局承诺、各卷大致分工。
- 不写：逐章细纲、场景对白、百科设定。

卷纲：

- 根据：全书故事线里分配给本卷的任务。
- 写：本卷要完成什么；开卷时世界和人物处于什么状态、卷末必须变成什么；本卷主冲突；必须推进的剧情点；必须种下或回收的伏笔；交给下一卷什么。
- 不写：另一本书，也不要复述全书故事线。

剧情点：

- 根据：所属卷纲。
- 概要写大脉络：因何触发、人物做什么选择、直接后果、压力如何升级、这段结束时局面变成什么样。
- 故事情节再把概要拆成可写场景链：场景顺序、信息投放、人物选择、情绪推进、与前后情节的咬合。写到可执行场景为止，不要写成小说正文。

故事事件：

- 根据：所属剧情点。
- 写真正发生了什么（故事真相），并标明时间、地点、牵涉人物。它不是读者看见的呈现方式。
- 需要时补事件连接：先后、同时、重叠、导致、使能、掩盖。
- 叙事落点再决定这件事在哪一章、以场景/回忆/线索/误导/揭示等方式出现、对读者披露到哪一层，并写一句写作指引。

伏笔：

- 根据：全书故事线和剧情点里必须先藏后露的信息。
- 先建伏笔线：名称、核心问题（读者会持续追问什么）、隐藏真相（作者知道但暂不告诉读者的答案）、预期读者效果（怀疑、误判或恍然）、计划跨度（剧情点内/卷内/跨卷）。
- 再排触点：真相源头、埋设、强化、误导、部分揭示、揭示、回收、余波。尚未确定落章时，先锚到分卷或剧情点并写计划范围；能确定时再落到事件或章卡。触点说明写读者实际看到什么、希望形成什么判断。
- 账本不能新增伏笔线和触点。正文里看起来像伏笔、但总览没有的，只在对话里提醒补设计。

章卡：

- 根据：所属卷纲、关联剧情点、相关故事情节与事件、本章应执行的伏笔触点、出场人物和世界约束。
- 必须指定所属分卷；剧情点关联可为空，非空时必须与章卡同卷。
- 写本章任务，不写小说正文。建议写清：本章要完成什么、场景顺序、出场人物、本章必须遵守的世界约束、起始状态、结束状态、关键选择、信息投放、结尾钩子、本章要埋设/强化/回收的伏笔。
- 开局确定本章节要写的字数，3000-5000字最佳。

## 正文阶段

每张章卡对应一份独立 Markdown 正文。

- 根据：本章章卡、落到本章的叙事落点和伏笔触点、出场人物的核心档案与关系、相关世界设定、前章正文和前章接续包（后两者只参考）。
- 只写当前锁定章的小说正文。不创建章节结构，不编写连续性文件，不把章节标题、相邻章节、分析过程或写作说明写进正文。
- 连续写作前确认起点，从第一张空白章卡开始，不跨过空白前章。
- 已有连续性记录仍可参考，但不限制正文修订。冲突通过人物行动、选择、对白和可感知细节推进，不要把章卡或剧情点原文抄进小说。
- 除非用户要求，不要直接把章节账本记录完成。

## 持续性账本阶段

按章或按连续章节批次留存人物轨迹、世界观揭露、既有伏笔触点变化、章末状态和下一章接续包。

- 单章提交视为只有一章的批次。多章批次必须属于同一本书、按叙事顺序连续、正文均已写完且都没有既有连续性记录。
- 根据：批次内全部已写成的正文，以及这些章节伏笔总览里已有的触点。任一正文未读都不得提交整批。
- 批次中间章不生成也不绑定章末状态、接续包、人物当前状态/历史轨迹、世界观揭露或伏笔变化文件。只在批次最后一章生成一次汇总连续性文件，内容反映整批结束后的最终状态，并作为下一章起点。
- 末章章末状态写整批结束时的处境、关系、情绪、已知与隐瞒信息、关键物品和未解决冲突；接续包写必须带到下一章的事实、下一章不可违背的约束、仍打开的问题。
- 整批有世界观新揭露时才在末章写揭露记录；人物在批次内有变化时，末章当前状态写批次结束时他是什么样，末章历史轨迹汇总这一批发生了什么。
- 伏笔总览是设计源。账本只核验整批既有触点是已兑现还是错过，并把正文证据汇总写入末章伏笔变化；不得自行新增伏笔线或触点。
- 一个批次只形成一条账本记录，批次内所有章节共用同一个记录身份。删除批次内任一章节会使整批记录失效，其余章节恢复为未提交状态。
- 记录只供后续参考，不锁定正文、人物资料或剧情结构。
`;

export function longAgentsMdCharacterCount(content: string): number {
  return Array.from(content).length;
}

export const LongWorkspaceSchemaVersionSchema = z.literal(
  LONG_WORKSPACE_SCHEMA_VERSION
);
export type LongWorkspaceSchemaVersion = z.infer<
  typeof LongWorkspaceSchemaVersionSchema
>;

export const LongProjectManifestSchemaVersionSchema = z.literal(
  LONG_PROJECT_MANIFEST_SCHEMA_VERSION
);
export type LongProjectManifestSchemaVersion = z.infer<
  typeof LongProjectManifestSchemaVersionSchema
>;

/**
 * Long-form ids are opaque and stable. Display names and mutable ordering must
 * never be encoded as the identity of an entity.
 */
export const LongStableIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(
    /^[a-z][a-z0-9-]*_[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/,
    "Long-form ids must be opaque, prefixed stable ids."
  );
export type LongStableId = z.infer<typeof LongStableIdSchema>;

function stableIdWithPrefix(prefix: string) {
  return LongStableIdSchema.refine((value) => value.startsWith(`${prefix}_`), {
    message: `Expected a stable ${prefix}_ id.`
  });
}

export const LongBookIdSchema = stableIdWithPrefix("longbook");
export type LongBookId = z.infer<typeof LongBookIdSchema>;
export const LongWorldbuildingCategoryIdSchema = stableIdWithPrefix("world");
export type LongWorldbuildingCategoryId = z.infer<
  typeof LongWorldbuildingCategoryIdSchema
>;
export const LongWorldbuildingItemIdSchema = stableIdWithPrefix("worlditem");
export type LongWorldbuildingItemId = z.infer<
  typeof LongWorldbuildingItemIdSchema
>;
export const LongCharacterIdSchema = stableIdWithPrefix("character");
export type LongCharacterId = z.infer<typeof LongCharacterIdSchema>;
export const LongCustomCharacterTypeIdSchema = stableIdWithPrefix("chartype");
export type LongCustomCharacterTypeId = z.infer<
  typeof LongCustomCharacterTypeIdSchema
>;
export const LongVolumeIdSchema = stableIdWithPrefix("volume");
export type LongVolumeId = z.infer<typeof LongVolumeIdSchema>;
export const LongArcIdSchema = stableIdWithPrefix("arc");
export type LongArcId = z.infer<typeof LongArcIdSchema>;
export const LongChapterCardIdSchema = stableIdWithPrefix("chapter");
export type LongChapterCardId = z.infer<typeof LongChapterCardIdSchema>;
export const LongStoryEventIdSchema = stableIdWithPrefix("event");
export type LongStoryEventId = z.infer<typeof LongStoryEventIdSchema>;
/** Plot-point-bound story plot entries shown in the「故事情节」tab. */
export const LongStoryPlotIdSchema = stableIdWithPrefix("storyplot");
export type LongStoryPlotId = z.infer<typeof LongStoryPlotIdSchema>;
export const LongEventConnectionIdSchema = stableIdWithPrefix("connection");
export type LongEventConnectionId = z.infer<typeof LongEventConnectionIdSchema>;
export const LongNarrativePlacementIdSchema = stableIdWithPrefix("placement");
export type LongNarrativePlacementId = z.infer<
  typeof LongNarrativePlacementIdSchema
>;
export const LongForeshadowingIdSchema = stableIdWithPrefix("foreshadow");
export type LongForeshadowingId = z.infer<typeof LongForeshadowingIdSchema>;
export const LongForeshadowingBeatIdSchema = stableIdWithPrefix("beat");
export type LongForeshadowingBeatId = z.infer<
  typeof LongForeshadowingBeatIdSchema
>;
export const LongLedgerCommitIdSchema = stableIdWithPrefix("commit");
export type LongLedgerCommitId = z.infer<typeof LongLedgerCommitIdSchema>;
export const LongContinuityFactIdSchema = stableIdWithPrefix("fact");
export type LongContinuityFactId = z.infer<typeof LongContinuityFactIdSchema>;
export const LongContinuityOpenLoopIdSchema = stableIdWithPrefix("loop");
export type LongContinuityOpenLoopId = z.infer<
  typeof LongContinuityOpenLoopIdSchema
>;
export const LongFileIdSchema = stableIdWithPrefix("file");
export type LongFileId = z.infer<typeof LongFileIdSchema>;

function isSafeLongProjectPath(value: string): boolean {
  if (
    value.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(value) ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false;
  }
  const segments = value.split("/");
  return (
    segments.length > 1 &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    ) &&
    (value.endsWith(".md") || value.endsWith(".json"))
  );
}

export const LongProjectRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(isSafeLongProjectPath, {
    message:
      "Long-form project paths must be safe relative Markdown or JSON paths."
  });
export type LongProjectRelativePath = z.infer<
  typeof LongProjectRelativePathSchema
>;

export const LongWorkspaceFileReferenceSchema = z
  .object({
    id: LongFileIdSchema,
    path: LongProjectRelativePathSchema,
    updatedAt: LongTimestampSchema
  })
  .strict();
export type LongWorkspaceFileReference = z.infer<
  typeof LongWorkspaceFileReferenceSchema
>;

export const LongMarkdownFileReferenceSchema =
  LongWorkspaceFileReferenceSchema.refine((file) => file.path.endsWith(".md"), {
    path: ["path"],
    message: "This long-form file must use a .md path."
  });
export type LongMarkdownFileReference = z.infer<
  typeof LongMarkdownFileReferenceSchema
>;

export const LongJsonFileReferenceSchema =
  LongWorkspaceFileReferenceSchema.refine(
    (file) => file.path.endsWith(".json"),
    {
      path: ["path"],
      message: "This long-form file must use a .json path."
    }
  );
export type LongJsonFileReference = z.infer<typeof LongJsonFileReferenceSchema>;

export function longWorldbuildingFileId(categoryId: string): string {
  return `file_${categoryId}:content`;
}

export function longWorldbuildingOverviewFileId(categoryId: string): string {
  return `file_${categoryId}:overview`;
}

export function longWorldbuildingItemFileId(itemId: string): string {
  return `file_${itemId}:content`;
}

export const LONG_CHARACTER_OVERVIEW_FILE_ID =
  "file_characters:overview" as const;
export const LONG_CHARACTER_OVERVIEW_PATH =
  "long/characters/overview.md" as const;

export function longCharacterOverviewFileId(): string {
  return LONG_CHARACTER_OVERVIEW_FILE_ID;
}

export function longCharacterOverviewContentPath(): string {
  return LONG_CHARACTER_OVERVIEW_PATH;
}

export function longCharacterCoreProfileFileId(characterId: string): string {
  return `file_${characterId}:core-profile`;
}

export function longCharacterRelationshipsFileId(characterId: string): string {
  return `file_${characterId}:relationships`;
}

export function longCharacterCurrentStateFileId(characterId: string): string {
  return `file_${characterId}:current-state`;
}

export function longCharacterHistoryFileId(characterId: string): string {
  return `file_${characterId}:history`;
}

export function longStoryPlotBodyFileId(storyPlotId: string): string {
  return `file_${storyPlotId}:body`;
}

export function longChapterBodyFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:body`;
}

export function longChapterCardFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:card`;
}

export function longChapterCharacterStateFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:character-state`;
}

export function longChapterHandoffFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:handoff`;
}

export function longChapterForeshadowingChangesFileId(
  chapterCardId: string
): string {
  return `file_${chapterCardId}:continuity:foreshadowing-changes`;
}

export function longChapterWorldRevealsFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:continuity:world-reveals`;
}

export function longChapterCharacterCurrentStateFileId(
  chapterCardId: string,
  characterId: string
): string {
  return `file_${chapterCardId}:continuity:character:${characterId}:current-state`;
}

export function longChapterCharacterHistoryFileId(
  chapterCardId: string,
  characterId: string
): string {
  return `file_${chapterCardId}:continuity:character:${characterId}:history`;
}

export function longLedgerCommitFileId(commitId: string): string {
  return `file_${commitId}:ledger`;
}

export const LongChapterBodyStatusSchema = z.enum(["empty", "written"]);
export type LongChapterBodyStatus = z.infer<typeof LongChapterBodyStatusSchema>;

export function longWorldbuildingContentPath(categoryId: string): string {
  return `long/worldbuilding/${categoryId}/content.md`;
}

export function longWorldbuildingOverviewContentPath(
  categoryId: string
): string {
  return `long/worldbuilding/${categoryId}/overview.md`;
}

export function longWorldbuildingItemContentPath(
  categoryId: string,
  itemId: string
): string {
  return `long/worldbuilding/${categoryId}/items/${itemId}.md`;
}

export function longCharacterFilePath(
  characterId: string,
  filename:
    "core-profile.md" | "relationships.md" | "current-state.md" | "history.md"
): string {
  return `long/characters/${characterId}/${filename}`;
}

export function longChapterFilePath(
  chapterCardId: string,
  filename: "body.md" | "card.md" | "character-state.md" | "handoff.md"
): string {
  return `long/chapters/${chapterCardId}/${filename}`;
}

export function longChapterContinuityFilePath(
  chapterCardId: string,
  filename: "foreshadowing-changes.md" | "world-reveals.md"
): string {
  return `long/continuity/chapters/${chapterCardId}/${filename}`;
}

export function longChapterCharacterContinuityFilePath(
  chapterCardId: string,
  characterId: string,
  filename: "current-state.md" | "history.md"
): string {
  return `long/continuity/chapters/${chapterCardId}/characters/${characterId}/${filename}`;
}

export function longStoryPlotFilePath(
  storyPlotId: string,
  filename: "body.md" = "body.md"
): string {
  return `long/story-plots/${storyPlotId}/${filename}`;
}

export function createEmptyLongMarkdownFileReference(
  id: string,
  path: string,
  updatedAt: string
): LongMarkdownFileReference {
  return LongMarkdownFileReferenceSchema.parse({
    id,
    path,
    updatedAt
  });
}

export const LONG_BOOK_LINE_FILE_ID = "file_long-book-line" as const;
export const LONG_WORKSPACE_INDEX_FILE_ID =
  "file_long-workspace-index" as const;
