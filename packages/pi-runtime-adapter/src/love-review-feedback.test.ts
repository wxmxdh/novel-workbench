import { describe, expect, it, vi } from "vitest";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import type { LoveReviewReport } from "@deepwrite/contracts";
import { finalizeLoveReviewActualOutput } from "./love-review-finalizer";
import {
  createLoveReviewRunState,
  loveReviewEvidenceSources,
  loveReviewPacket,
  loveReviewSystemRequirements
} from "./love-review-runtime";
import { loveFeedbackNotice } from "./love-review-feedback";
import { blockedLoveReviewOutput } from "./love-review-output-guard";
import { reviewFixture } from "./love-review.test-support";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";

function fixture(remaining = false) {
  const review = reviewFixture("请审阅第一章，不扩大我的局部意见。");
  const runtime = {
    mode: "provider" as const,
    provider: "feedback-test",
    model: "parent"
  };
  const faux = fauxProvider({
    api: "feedback-test",
    provider: "feedback-test",
    tokensPerSecond: 0,
    models: [{ id: "parent", name: "Parent" }]
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const state = createLoveReviewRunState();
  review.snapshot.reports.push({
    reviewerId: "love-outline",
    phase: "specialist",
    runtime,
    report: JSON.parse(review.report())
  });
  review.snapshot.coverage = {
    ...review.snapshot.coverage,
    missingReviewerIds: [],
    completedCount: 1,
    state: "needs_independent_review"
  };
  state.latestReviewId = review.snapshot.reviewId;
  state.reviews.set(review.snapshot.reviewId, {
    snapshot: structuredClone(review.snapshot),
    coverage: review.snapshot.coverage
  });
  const first = JSON.parse(
    review.report(["love-outline:specialist", "main:summary", "main-summary"])
  );
  first.findings = [
    {
      id: "overreach",
      category: "literary-suggestion",
      scope: "本章此处",
      sourceId: "main-summary",
      quote: "必须禁止所有联想。",
      issue: "把局部建议扩大成禁令，且遗漏人物审阅员的保留意见。"
    }
  ];
  const second = JSON.parse(
    review.report(["love-outline:specialist", "main:summary", "main-summary"])
  );
  if (remaining)
    second.findings = [
      {
        ...first.findings[0],
        id: "remaining",
        quote: "可保留联想",
        issue: "此处仍存在文学分歧，待作者决定。"
      }
    ];
  faux.setResponses([
    fauxAssistantMessage(JSON.stringify(first)),
    fauxAssistantMessage(JSON.stringify(second))
  ]);
  const input: BuildSpawnSubagentToolInput = {
    parentSessionId: "session",
    parentRuntime: runtime,
    model: faux.getModel("parent") as Model<Api>,
    thinkingLevel: "off",
    streamFn: (m, c, o) => models.streamSimple(m, c, o),
    definitions: [
      {
        id: "love-intent",
        name: "复核员",
        description: "核对",
        systemPrompt: "核对",
        enabled: true,
        modelMode: "inherit"
      }
    ],
    buildChildTools: () => [],
    loveReviewCoordinates: {
      bookId: "longbook_9a146bbe",
      sessionId: "session",
      runId: "run"
    },
    loveReviewAuthorText: review.snapshot.authorText,
    loveReviewExecutor: review.executor,
    loveReviewRunState: state
  };
  return { review, state, runtime, input };
}

describe("LOVE bounded summary feedback", () => {
  it("indexes opposing findings by source while preserving report IDs and uncertain items", () => {
    const review = reviewFixture("请对照本轮报告，不作作者决定。"),
      quote = "合成测试材料：人物去留有分歧；发书未定；卡通杯不能推断家庭。",
      report = (
        summary: string,
        findings: LoveReviewReport["findings"] = [],
        missingSources: string[] = []
      ): LoveReviewReport => ({
        status: missingSources.length
          ? ("incomplete" as const)
          : ("reviewed" as const),
        summary,
        findings,
        missingSources,
        reviewedSourceIds: ["draft-1", "author-request", "rules"]
      }),
      runtime = {
        mode: "provider" as const,
        provider: "fixture",
        model: "fixture"
      };
    review.snapshot.targets[0]!.content = quote;
    review.snapshot.reports.push(
      {
        reviewerId: "love-outline",
        phase: "specialist",
        runtime,
        report: report("合成报告A", [
          {
            id: "keep-person",
            category: "literary-suggestion",
            scope: "合成结构用例",
            issue: "合成意见：建议保留人物。",
            sourceId: "draft-1",
            quote
          }
        ])
      },
      {
        reviewerId: "love-character",
        phase: "specialist",
        runtime,
        report: report("合成报告B", [
          {
            id: "remove-person",
            category: "literary-suggestion",
            scope: "合成结构用例",
            issue: "合成意见：建议删去人物。",
            sourceId: "draft-1",
            quote
          }
        ])
      },
      {
        reviewerId: "love-life",
        phase: "specialist",
        runtime,
        report: report(
          "合成报告C",
          [
            {
              id: "pending-status",
              category: "uncertain",
              scope: "合成结构用例",
              issue: "合成待核：发书状态未定，卡通杯不能推出家庭背景。",
              sourceId: "draft-1",
              quote
            }
          ],
          ["合成待核来源"]
        )
      },
      {
        reviewerId: "love-viewpoint",
        phase: "specialist",
        runtime,
        report: report("合成报告D")
      },
      {
        reviewerId: "love-expression",
        phase: "specialist",
        runtime,
        report: report("合成报告E")
      },
      {
        reviewerId: "main",
        phase: "summary",
        runtime,
        report: report("唯一主汇总测试字串")
      },
      {
        reviewerId: "love-intent",
        phase: "independent",
        runtime,
        report: report("合成独立复核")
      }
    );

    const packet = loveReviewPacket(review.snapshot),
      index = packet.slice(
        packet.indexOf("【已提交报告对照索引"),
        packet.indexOf("【本轮已经持久提交的报告全文")
      ),
      sources = loveReviewEvidenceSources(review.snapshot),
      sourceIds = sources.map(({ id }) => id),
      prompt = loveReviewSystemRequirements({
        snapshot: review.snapshot,
        reviewerId: "love-intent",
        phase: "independent"
      });

    expect(packet).toContain("建议保留人物");
    expect(packet).toContain("建议删去人物");
    expect(packet).toContain("love-outline:specialist");
    expect(packet).toContain("love-character:specialist");
    expect(packet).toContain("uncertain");
    expect(packet).toContain("合成待核来源");
    expect(packet).toContain("原报告全文");
    expect(packet.match(/唯一主汇总测试字串/g)).toHaveLength(1);
    expect(index).toContain("love-outline:specialist#keep-person");
    expect(index).toContain("love-character:specialist#remove-person");
    expect(index).toContain("love-life:specialist#pending-status");
    expect(index).toContain("uncertain");
    expect(index).not.toContain(quote);
    expect(index).not.toContain("建议保留人物");
    expect(sourceIds).toContain("main:summary");
    expect(sourceIds).toContain("main-summary");
    expect(sources.find(({ id }) => id === "main-summary")?.content).toBe(
      "唯一主汇总测试字串"
    );
    expect(prompt).toContain(JSON.stringify(sourceIds));
    expect(prompt).toContain("遗漏的相反意见");
    expect(prompt).toContain("uncertain finding 与 missingSources 保持待核");
  });

  it("shows report attribution, source ID, quote, and pending sources in feedback", () => {
    const review = reviewFixture("请保留分歧，不推断未确认事实。"),
      quote = "合成证据原句";
    review.snapshot.reports.push({
      reviewerId: "love-intent",
      phase: "independent",
      runtime: { mode: "provider", provider: "fixture", model: "fixture" },
      report: {
        status: "incomplete",
        summary: "合成未决意见。",
        findings: [
          {
            id: "uncertain-family",
            category: "uncertain",
            scope: "合成场景",
            issue: "卡通杯不足以推断家庭情况。",
            sourceId: "draft-1",
            quote,
            reportId: "love-life:specialist"
          }
        ],
        missingSources: ["家庭背景来源"],
        reviewedSourceIds: ["draft-1"]
      }
    });
    const notice = loveFeedbackNotice(review.snapshot);
    expect(notice).toContain("[uncertain]");
    expect(notice).toContain("提交报告 ID：love-intent:independent");
    expect(notice).toContain("引用报告 ID：love-life:specialist");
    expect(notice).toContain("sourceId：draft-1");
    expect(notice).toContain(quote);
    expect(notice).toContain("家庭背景来源");
  });

  it("returns actual audit findings to the parent and rechecks its actual corrected text", async () => {
    const f = fixture();
    const reviseSummary = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("遗漏人物审阅员的保留意见");
      expect(prompt).toContain("实际磁盘稿件");
      expect(prompt).toContain("love-outline:specialist");
      expect(prompt).toContain("love-intent:independent");
      expect(prompt).toContain("sourceId");
      return "可保留联想，删改意见存在分歧；尚未改正文。";
    });
    const coverage = await finalizeLoveReviewActualOutput({
      subagentInput: f.input,
      state: f.state,
      runtime: f.runtime,
      content: "必须禁止所有联想。",
      reviseSummary
    });
    expect(coverage?.state).toBe("ready");
    expect(reviseSummary).toHaveBeenCalledTimes(1);
    expect(
      f.review.snapshot.reports.find((r) => r.phase === "summary")?.report
        .summary
    ).toBe(f.state.correctedContent);
    expect(f.state.feedbackNotice).toBeUndefined();
    expect(
      blockedLoveReviewOutput(f.state, { reviewCoverage: coverage! })
    ).toBeUndefined();
  });
  it("keeps unresolved disagreement visible and never starts another correction loop", async () => {
    const f = fixture(true),
      reviseSummary = vi.fn(async () => "可保留联想，但表达分寸待讨论。");
    const coverage = await finalizeLoveReviewActualOutput({
      subagentInput: f.input,
      state: f.state,
      runtime: f.runtime,
      content: "必须禁止所有联想。",
      reviseSummary
    });
    expect(reviseSummary).toHaveBeenCalledTimes(1);
    expect(
      blockedLoveReviewOutput(f.state, { reviewCoverage: coverage! })
    ).toContain("仍存在文学分歧");
    expect(f.state.correctedContent).toBe("可保留联想，但表达分寸待讨论。");
  });
  it("reports correction failure without replacing the original with invented success", async () => {
    const f = fixture();
    const coverage = await finalizeLoveReviewActualOutput({
      subagentInput: f.input,
      state: f.state,
      runtime: f.runtime,
      content: "必须禁止所有联想。",
      reviseSummary: async () => {
        throw new Error("供应商暂时失败");
      }
    });
    expect(coverage?.state).toBe("ready");
    expect(f.state.correctedContent).toBeUndefined();
    expect(f.state.feedbackNotice).toContain("供应商暂时失败");
    expect(
      f.review.snapshot.reports.find((r) => r.phase === "summary")?.report
        .summary
    ).toBe("必须禁止所有联想。");
  });
  it("does not interpret complete reports as justified conclusions when no correction callback exists", async () => {
    const f = fixture();
    const coverage = await finalizeLoveReviewActualOutput({
      subagentInput: f.input,
      state: f.state,
      runtime: f.runtime,
      content: "必须禁止所有联想。"
    });
    expect(
      blockedLoveReviewOutput(f.state, { reviewCoverage: coverage! })
    ).toContain("仍需作者核对");
  });
});
