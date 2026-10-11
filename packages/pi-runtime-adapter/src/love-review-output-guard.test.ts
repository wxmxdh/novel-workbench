import { describe, expect, it } from "vitest";
import {
  blockedLoveReviewOutput,
  requestsLoveReviewExecution
} from "./love-review-output-guard";
import { createLoveReviewRunState } from "./love-review-runtime";
import { reviewFixture } from "./love-review.test-support";

describe("source-bound LOVE review status", () => {
  it("does not convert a question about earlier reviews into a new team execution", () => {
    for (const prompt of [
      "你认为审核团队有没有发现这个问题，为什么？",
      "那你认为还需要添加审阅模型吗",
      "请解释团队审核失败的原因"
    ]) {
      expect(requestsLoveReviewExecution(prompt)).toBe(false);
    }
    for (const prompt of [
      "请团队完整审阅第一章",
      "再完整审核一轮",
      "先取得四稿全文，再让团队并行审阅"
    ]) {
      expect(requestsLoveReviewExecution(prompt)).toBe(true);
    }
  });

  it("states the exact partial completion without inventing missing members' decisions", () => {
    const f = reviewFixture("请审阅", ["love-outline", "love-life"]);
    f.snapshot.coverage.completedCount = 1;
    f.snapshot.coverage.missingReviewerIds = ["love-life"];
    const state = createLoveReviewRunState();
    state.reviews.set(f.snapshot.reviewId, {
      snapshot: f.snapshot,
      coverage: f.snapshot.coverage
    });
    const result = blockedLoveReviewOutput(state, {
      reviewCoverage: f.snapshot.coverage
    });
    expect(result).toContain("已登记 1/2");
    expect(result).toContain("未完成成员：love-life");
    expect(result).toContain("复核尚未完成");
    expect(
      blockedLoveReviewOutput(state, {
        reviewCoverage: {
          ...f.snapshot.coverage,
          state: "ready",
          completedCount: 2,
          missingReviewerIds: []
        }
      })
    ).toBeUndefined();
  });
});
