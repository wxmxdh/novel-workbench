import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";

export const LONG_LIST_STAGE_LABELS = {
  worldbuilding: "世界观",
  character: "人物",
  plot: "剧情",
  draft: "正文",
  continuity: "连续性"
} as const;

const BODY_STATUS_LABELS = {
  empty: "空白",
  written: "已写"
} as const;

const EXECUTION_STATUS_LABELS = {
  planned: "计划中",
  written: "已写入正文",
  committed: "已记录",
  missed: "已遗漏"
} as const;

const FORESHADOWING_STATUS_LABELS = {
  planned: "计划中",
  open: "已埋设",
  progressing: "推进中",
  resolved: "已回收",
  abandoned: "已放弃"
} as const;

const BEAT_TYPE_LABELS = {
  source: "来源",
  plant: "埋设",
  reinforce: "强化",
  misdirect: "误导",
  partial_reveal: "部分揭示",
  reveal: "揭示",
  payoff: "回收",
  aftermath: "余波"
} as const;

const CONNECTION_TYPE_LABELS = {
  before: "先于",
  same_time: "同时",
  overlaps: "时间重叠",
  causes: "导致",
  enables: "促成",
  conceals: "掩盖"
} as const;

const NARRATIVE_MODE_LABELS = {
  scene: "场景",
  flashback: "闪回",
  retelling: "转述",
  clue: "线索",
  misdirection: "误导",
  reveal: "揭示",
  dream: "梦境",
  prophecy: "预言"
} as const;

const DISCLOSURE_LABELS = {
  hint: "暗示",
  partial: "部分披露",
  full: "完整披露",
  false: "虚假披露"
} as const;

export function listScopeHeader(
  stage: keyof typeof LONG_LIST_STAGE_LABELS,
  title: string,
  scopeId: string
): string {
  return `范围：${LONG_LIST_STAGE_LABELS[stage]} / ${title}（${scopeId}）`;
}

export function countLine(count: number, unit: string): string {
  return `共 ${count} ${unit}：`;
}

export function bodyStatusLabel(status: "empty" | "written"): string {
  return BODY_STATUS_LABELS[status];
}

export function executionStatusLabel(
  status: keyof typeof EXECUTION_STATUS_LABELS
): string {
  return EXECUTION_STATUS_LABELS[status];
}

export function foreshadowingStatusLabel(
  status: keyof typeof FORESHADOWING_STATUS_LABELS
): string {
  return FORESHADOWING_STATUS_LABELS[status];
}

export function beatTypeLabel(type: keyof typeof BEAT_TYPE_LABELS): string {
  return BEAT_TYPE_LABELS[type];
}

export function connectionTypeLabel(
  type: keyof typeof CONNECTION_TYPE_LABELS
): string {
  return CONNECTION_TYPE_LABELS[type];
}

export function narrativeModeLabel(
  mode: keyof typeof NARRATIVE_MODE_LABELS
): string {
  return NARRATIVE_MODE_LABELS[mode];
}

export function disclosureLabel(
  disclosure: keyof typeof DISCLOSURE_LABELS
): string {
  return DISCLOSURE_LABELS[disclosure];
}

export function nextStepLine(guidance: string): string {
  const trimmed = guidance.trim();
  return `下一步：${trimmed.endsWith("。") ? trimmed : `${trimmed}。`}`;
}

export function nextReadLine(call: string): string {
  return nextStepLine(`需要正文时使用 ${call}。`);
}

export function chapterTitle(
  index: LongWorkspaceIndexSnapshot,
  chapterCardId: string
): string {
  return (
    index.plot.chapterCards.find(({ id }) => id === chapterCardId)?.title ??
    chapterCardId
  );
}

export function eventTitle(
  index: LongWorkspaceIndexSnapshot,
  eventId: string
): string {
  return (
    index.plot.storyEvents.find(({ id }) => id === eventId)?.title ?? eventId
  );
}

export function characterName(
  index: LongWorkspaceIndexSnapshot,
  characterId: string
): string {
  return (
    index.characters.find(({ id }) => id === characterId)?.name ?? characterId
  );
}

export function resolvedBeatChapterId(
  index: LongWorkspaceIndexSnapshot,
  beat: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"][number]["beats"][number]
): string | null {
  if (beat.chapterCardId) return beat.chapterCardId;
  if (!beat.placementId) return null;
  return (
    index.plot.narrativePlacements.find(({ id }) => id === beat.placementId)
      ?.chapterCardId ?? null
  );
}

export function unknownScope(scopeId: string): never {
  throw new Error(
    `未找到范围 ${scopeId}；请使用当前上下文或上一次 list 返回的 scope_id。`
  );
}

export function leafScope(scopeId: string, readCall: string): never {
  throw new Error(
    `${scopeId} 是正文或叶子对象，没有结构化子列表；请使用 ${readCall}，不要再调用 list。`
  );
}

export function wrongStage(
  scopeId: string,
  expectedStage: keyof typeof LONG_LIST_STAGE_LABELS,
  extraHint?: string
): never {
  const hint = extraHint?.trim();
  const suffix =
    hint === undefined || hint.length === 0
      ? ""
      : hint.endsWith("。")
        ? hint
        : `${hint}。`;
  throw new Error(
    `范围 ${scopeId} 不能用于当前阶段；请改用 stage=${expectedStage}。${suffix}`
  );
}
