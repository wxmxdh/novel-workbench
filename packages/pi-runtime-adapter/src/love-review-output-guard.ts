import type { LoveReviewCoverage } from "@deepwrite/contracts";
import type { LoveReviewRunState } from "./love-review-runtime";

export function requestsLoveReviewExecution(prompt: string): boolean {
  return (
    /(?:请|再|重新|重试|开始|启动|让|帮我)[\s，,]*(?:团队|成员)?[\s，,]*(?:并行|并发|完整|全部|重新|再)?[\s，,]*(?:审阅|审核|复核|审查)/u.test(
      prompt
    ) ||
    /^(?:审阅|审核|复核|审查)[\s第一二三四五六七八九十0-9卷章]/u.test(
      prompt.trim()
    ) ||
    /(?:调用|安排|启动)(?:团队|成员)[\s，,]*(?:来|进行)?[\s，,]*(?:完整|并行|并发)?[\s，,]*(?:审阅|审核|复核|审查)/u.test(
      prompt
    )
  );
}

/** Emit source-bound execution status instead of an unsupported team verdict. */
export function blockedLoveReviewOutput(
  state: LoveReviewRunState,
  result: { reviewCoverage?: LoveReviewCoverage; reviewNotice?: "not_started" }
): string | undefined {
  const coverage = result.reviewCoverage;
  if (coverage?.state === "ready") {
    if (!state.feedbackNotice) return undefined;
    return [
      state.feedbackNotice,
      "以下为主模型的审阅总结，仍须结合上述意见判断：",
      state.correctedContent ??
        state.reviews
          .get(coverage.reviewId)
          ?.snapshot.reports.find((entry) => entry.phase === "summary")?.report
          .summary ??
        ""
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (!coverage && !result.reviewNotice) return undefined;
  const snapshot = coverage
    ? state.reviews.get(coverage.reviewId)?.snapshot
    : [...state.reviews.values()].at(-1)?.snapshot;
  return [
    "本轮团队审阅尚未完成，暂不交付团队结论或定稿建议。",
    snapshot
      ? `已取得 ${snapshot.volume}第${snapshot.chapter}章 ${snapshot.targets.length} 份待审文本；审阅编号 ${snapshot.reviewId}。`
      : "本轮尚未取得受控审阅资料，不能声称已读或已审。",
    coverage
      ? `专业报告已登记 ${coverage.completedCount}/${coverage.expectedCount}；当前状态：${coverage.state}。`
      : "专业团队尚未启动。",
    ...(coverage?.missingReviewerIds.length
      ? [`未完成成员：${coverage.missingReviewerIds.join("、")}。`]
      : []),
    coverage?.state === "stale"
      ? "稿件或依据版本已变化，旧报告不能证明当前版本已审。"
      : "作者意图与最终汇总复核尚未完成，主模型不能代替这些成员宣称复核通过。",
    "已保存稿件与已登记报告保留；具体失败原因见本轮任务记录。"
  ].join("\n\n");
}
