import { describe, expect, it } from "vitest";
import { validateLoveReviewReport } from "./love-review-report";

const sources = [
  { id: "draft-a", content: "教室里有人在翻卷子。" },
  { id: "outline", content: "人物暂时不应直接表态。" }
];

function report(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: "reviewed",
    summary: "完成阅读。",
    findings: [
      {
        id: "finding-1",
        category: "literary-suggestion",
        scope: "本章此段",
        issue: "节奏可再斟酌。",
        sourceId: "draft-a",
        quote: "有人在翻卷子"
      }
    ],
    missingSources: [],
    reviewedSourceIds: ["draft-a", "outline"],
    ...overrides
  });
}

describe("LOVE review report evidence validation", () => {
  it("accepts a structured report whose exact quote exists in the frozen source", () => {
    expect(validateLoveReviewReport(report(), sources)).toMatchObject({
      ok: true,
      report: { status: "reviewed", findings: [{ sourceId: "draft-a" }] }
    });
  });

  it("accepts fenced JSON while retaining an explicitly incomplete report", () => {
    const raw = `\`\`\`json\n${report({
      status: "incomplete",
      findings: [],
      missingSources: ["人物关系来源"]
    })}\n\`\`\``;
    expect(validateLoveReviewReport(raw, sources)).toMatchObject({
      ok: true,
      report: { status: "incomplete", missingSources: ["人物关系来源"] }
    });
  });

  it("rejects free prose, unknown sources, invented quotes, and contradictory completion", () => {
    expect(validateLoveReviewReport("我审完了。", sources)).toMatchObject({
      ok: false
    });
    expect(
      validateLoveReviewReport(
        report({
          findings: [
            {
              id: "finding-1",
              category: "conflict",
              scope: "全书",
              issue: "问题",
              sourceId: "missing",
              quote: "凭空引用"
            }
          ]
        }),
        sources
      )
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("未提供的来源")
    });
    expect(
      validateLoveReviewReport(
        report({
          findings: [
            {
              id: "finding-1",
              category: "conflict",
              scope: "全书",
              issue: "问题",
              sourceId: "draft-a",
              quote: "凭空引用"
            }
          ]
        }),
        sources
      )
    ).toMatchObject({ ok: false, reason: expect.stringContaining("不在来源") });
    expect(
      validateLoveReviewReport(report({ missingSources: ["来源B"] }), sources)
    ).toMatchObject({ ok: false, reason: expect.stringContaining("状态矛盾") });
  });
});
