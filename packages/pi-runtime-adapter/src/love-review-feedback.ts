import type {
  LoveReviewReport,
  LoveReviewSnapshot
} from "@deepwrite/contracts";
import { loveReviewPacket } from "./love-review-runtime";

export function independentReport(
  snapshot: LoveReviewSnapshot
): LoveReviewReport | undefined {
  return snapshot.reports.find((entry) => entry.phase === "independent")
    ?.report;
}

export function loveSummaryCorrectionPrompt(
  snapshot: LoveReviewSnapshot
): string {
  return [
    "请依据以下实际原文与报告，修正你刚才的审阅总结。这是本轮唯一一次汇总修正，不修改小说正文。",
    "逐项回应独立复核指出的问题：接受时收窄或撤回判断；不接受时给出原文依据；无法裁决时保留分歧。Gemini的意见也只是待核对判断，不自动成为作者指令。",
    "对照原报告 ID、sourceId 和原句引用说明意见归属；相反意见并列保留，uncertain 与缺失来源仍标待核，不按报告数量消解分歧。",
    "保留成立部分，补回相反意见。未知事实不能升级为已证实，章卡动作示例不能扩大成禁令，不依据另一份候选稿裁定本稿事实。",
    "最终只输出完整修正后的审阅总结。区分确定需修、可选建议、有分歧、待查证和应保留内容；注明这是审阅建议，尚未改正文。不要宣称一切问题全部解决。",
    loveReviewPacket(snapshot)
  ].join("\n\n");
}

export function loveFeedbackNotice(
  snapshot: LoveReviewSnapshot,
  error?: string
): string | undefined {
  const report = independentReport(snapshot);
  const hasMissingSources = Boolean(
    report?.missingSources.length || report?.status === "incomplete"
  );
  if (!report?.findings.length && !error && !hasMissingSources)
    return undefined;
  const independent = snapshot.reports.find(
    (entry) => entry.phase === "independent"
  );
  return [
    "独立复核列出以下意见或缺项供主汇总对照；这不表示已修改正文或替作者裁决。",
    ...(error ? [`汇总修正状态：${error}`] : []),
    ...(report?.missingSources.length
      ? [`尚待核对的来源：${report.missingSources.join("、")}`]
      : []),
    ...(report?.findings ?? []).map((finding) => {
      const submittedReportId = `${independent?.reviewerId ?? "independent"}:${independent?.phase ?? "independent"}`;
      return `- [${finding.category}] ${finding.issue}\n  范围：${finding.scope}；提交报告 ID：${submittedReportId}${finding.reportId ? `；引用报告 ID：${finding.reportId}` : ""}；sourceId：${finding.sourceId}\n  原句：${finding.quote}`;
    }),
    "意见与未决来源仍需作者核对；保留合理分歧，作者可以选择采纳、调整或保留原文。"
  ].join("\n\n");
}
