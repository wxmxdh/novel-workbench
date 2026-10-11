import type {
  AgentTeamWorkspaceType,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";

const LOVE_REVIEW_ROLE_IDS = new Set([
  "love-intent",
  "love-outline",
  "love-life",
  "love-character",
  "love-continuity",
  "love-viewpoint",
  "love-expression",
  "love-research"
]);

/**
 * Add a small, non-editable execution boundary to the LOVE review roles.
 * The persisted profile remains author-owned; this only affects definitions
 * resolved for the current runtime call.
 */
export function applyLoveReviewRuntimeBoundary(
  definitions: readonly ShortAgentSubagentDefinition[],
  scope: {
    workspaceType: AgentTeamWorkspaceType;
    bookId?: string;
    profileName: string;
  }
): ShortAgentSubagentDefinition[] {
  const isLoveProfile =
    scope.workspaceType === "long" &&
    scope.bookId === "longbook_9a146bbe" &&
    scope.profileName === "Love 现实主义青春题材 创作团队";
  return definitions.map((definition) => {
    if (!isLoveProfile || !isLoveReviewRole(definition.id))
      return { ...definition };
    return {
      ...definition,
      systemPrompt: appendBoundary(definition)
    };
  });
}

function isLoveReviewRole(id: string): boolean {
  return LOVE_REVIEW_ROLE_IDS.has(id);
}

function appendBoundary(definition: ShortAgentSubagentDefinition): string {
  const systemPrompt = definition.systemPrompt;
  const marker = "【LOVE审阅运行边界】";
  if (systemPrompt.includes(marker)) return systemPrompt;
  const intentBoundary =
    definition.id === "love-intent"
      ? "\n- 若本任务明确告知你与主模型使用同一型号，你仍可核查来源与推导，但不要把同模型输出称为独立模型共识；说明独立性限制，并建议交由既定的 Codex 终审作外部复核。"
      : "";
  return `${systemPrompt.trimEnd()}\n\n${marker}\n- 运行结束只说明任务停止；没有实际读取指定稿件全文并核对目标版本时，明确报告缺读/版本未核，不能声称完成该稿审阅。不得用“文本同上”、摘要、哈希或其他成员的上下文代替本成员实际取得的审阅材料。\n- 每项发现引用当前版本的原句与位置，标注判断类别（资料冲突、现实事实待核、文学建议、作者偏好或待核对）；缺证据时保留不确定性，不把局部意见扩大成全书规则，也不把建议写成硬伤。\n- 只报告本角色负责范围内的判断。不得把主模型的说法或其他成员未核实的意见写成团队共识；保留分歧、未审范围与成立内容.${intentBoundary}`;
}
