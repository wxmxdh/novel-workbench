import type { AgentRunInput } from "./runtime-types";

/** Use the same Main/Core-owned snapshots for ordinary long-team children. */
export function buildLongSubagentRequirements(input: AgentRunInput): string {
  const workspace = input.workspaceContext?.longWorkspace;
  const target = input.comparisonDraftWriterContext;
  const card = workspace?.navigation.chapterCards.find(
    ({ id }) => id === target?.chapterCardId
  );
  return [
    input.writeApprovalMode === "auto-approve"
      ? "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId；提案会进入实时自动保存队列，在客户端确认成功前不能宣称已落盘或已提交连续性账本。"
      : "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId；任何写入仍须形成可审阅提案，不能宣称已落盘或已提交连续性账本。",
    workspace ? `当前作品：《${workspace.title}》 / ${workspace.bookId}` : "",
    target
      ? `【本轮 Main 绑定的独立对照稿目标】\n第${target.chapter}章，真实章卡 ID：${target.chapterCardId}${card ? `，卷卡 ID：${card.volumeId}` : ""}。独立写作成员先调用 prepare_comparison_draft({"confirm_chapter":${target.chapter}})，工具会实际取得章卡、卷次与选定大纲全文并核对版本，无需猜测 ID 或先行 read。必须完整阅读返回材料后再创作；若来源缺失，报告该错误，不尝试相似章节。此定位不代表资料已经阅读。`
      : "",
    workspace?.agentsMd?.trim()
      ? `【本轮 Core 取得的项目执行说明全文】\n${workspace.agentsMd}`
      : "",
    ...(workspace?.requiredRules ?? []).map(
      (rule) =>
        `【本书必读规则 ${rule.title} / ${rule.itemId} / ${rule.updatedAt} / sha256=${rule.sha256}】\n${rule.content}`
    ),
    "以上资料说明来源与约束，不证明语义理解；作者最新具体决定优先，历史、候选及未决身份不得升级。普通查询目录仍不替代任务所需人物、关系和场景原文。"
  ]
    .filter(Boolean)
    .join("\n\n");
}
