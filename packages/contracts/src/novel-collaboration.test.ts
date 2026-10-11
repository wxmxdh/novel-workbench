import { describe, expect, it } from "vitest";
import {
  NovelPlotCandidateSetSchema,
  NovelRequirementReviewSchema
} from "./novel-collaboration";

const source = {
  bookId: "book-one",
  fileId: "file-chapter-body",
  path: "chapters/01/body.md",
  updatedAt: "2026-10-11T00:00:00.000Z",
  sha256: "a".repeat(64)
};

describe("novel collaboration review contracts", () => {
  it("requires quoted evidence before a requirement can be supported", () => {
    expect(
      NovelRequirementReviewSchema.safeParse({
        bookId: "book-one",
        chapterCardId: "chapter-one",
        checkedAt: "2026-10-11T00:00:00.000Z",
        sources: [source],
        checks: [
          {
            id: "req-1",
            requirement: "主角拒绝邀请",
            kind: "must-appear",
            status: "supported",
            evidence: []
          }
        ]
      }).success
    ).toBe(false);
  });

  it("rejects evidence from another book", () => {
    const parsed = NovelRequirementReviewSchema.safeParse({
      bookId: "book-one",
      chapterCardId: "chapter-one",
      checkedAt: "2026-10-11T00:00:00.000Z",
      sources: [source],
      checks: [
        {
          id: "req-1",
          requirement: "主角拒绝邀请",
          kind: "must-appear",
          status: "supported",
          evidence: [
            {
              source: { ...source, bookId: "book-two" },
              start: 0,
              end: 2,
              quote: "我不",
              explanation: "原文表明拒绝。"
            }
          ]
        }
      ]
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps plot proposals as candidates with their own source book", () => {
    const parsed = NovelPlotCandidateSetSchema.parse({
      bookId: "book-one",
      chapterCardId: "chapter-one",
      prompt: "为章节冲突提供两个发展方向",
      sources: [source],
      candidates: [
        {
          id: "candidate-1",
          model: "unknown",
          body: "候选剧情方向，仅供作者选择。",
          createdAt: "2026-10-11T00:00:00.000Z"
        }
      ]
    });
    expect(parsed.candidates[0]?.body).toContain("候选");
  });
});
