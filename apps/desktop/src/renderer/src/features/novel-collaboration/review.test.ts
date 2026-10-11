import { describe, expect, it } from "vitest";
import {
  candidateSetIsCurrent,
  extractSearchQueries,
  validateRequirementReview
} from "./review";
import type {
  NovelPlotCandidateSet,
  NovelRequirementReview,
  VersionedNovelSource
} from "@deepwrite/contracts";

const source: VersionedNovelSource = {
  bookId: "book-a",
  fileId: "body-a",
  path: "chapters/01/body.md",
  updatedAt: "2026-10-11T00:00:00.000Z",
  sha256: "a".repeat(64)
};

describe("novel collaboration review helpers", () => {
  it("turns a natural-language question into literal search terms", () => {
    expect(
      extractSearchQueries("帮我找一下他们第一次谈到搬家的那一段在哪里？")
    ).toEqual(["他们第一次谈到搬家的", "搬家"]);
  });

  it("marks evidence uncertain when the source version has changed", () => {
    const review: NovelRequirementReview = {
      bookId: "book-a",
      chapterCardId: "chapter-a",
      checkedAt: "2026-10-11T00:00:00.000Z",
      sources: [source],
      checks: [
        {
          id: "req-a",
          requirement: "主角拒绝邀请",
          kind: "must-appear",
          status: "supported",
          evidence: [
            {
              source,
              start: 0,
              end: 3,
              quote: "我不去",
              explanation: "明确拒绝。"
            }
          ]
        }
      ]
    };
    const result = validateRequirementReview(review, {
      currentBookId: "book-a",
      currentChapterCardId: "chapter-a",
      currentSources: [{ ...source, updatedAt: "2026-10-11T00:01:00.000Z" }],
      currentTextByFileId: new Map([[source.fileId, "我不去。"]])
    });
    expect(result[0]).toMatchObject({
      stale: true,
      check: { status: "uncertain" }
    });
  });

  it("also invalidates a no-evidence result when its reviewed source changes", () => {
    const review: NovelRequirementReview = {
      bookId: "book-a",
      chapterCardId: "chapter-a",
      checkedAt: "2026-10-11T00:00:00.000Z",
      sources: [source],
      checks: [
        {
          id: "req-a",
          requirement: "不得揭露秘密",
          kind: "must-preserve",
          status: "missing",
          evidence: []
        }
      ]
    };
    expect(
      validateRequirementReview(review, {
        currentBookId: "book-a",
        currentChapterCardId: "chapter-a",
        currentSources: [{ ...source, sha256: "b".repeat(64) }],
        currentTextByFileId: new Map([[source.fileId, "原文"]])
      })[0]
    ).toMatchObject({ stale: true, check: { status: "uncertain" } });
  });

  it("rejects a review for another book and a candidate based on stale sources", () => {
    const review: NovelRequirementReview = {
      bookId: "book-b",
      chapterCardId: "chapter-a",
      checkedAt: "2026-10-11T00:00:00.000Z",
      sources: [source],
      checks: [
        {
          id: "req-a",
          requirement: "一个要求",
          kind: "must-appear",
          status: "missing",
          evidence: []
        }
      ]
    };
    expect(
      validateRequirementReview(review, {
        currentBookId: "book-a",
        currentChapterCardId: "chapter-a",
        currentSources: [source],
        currentTextByFileId: new Map()
      })
    ).toMatchObject([
      { stale: true, message: "wrong-book", check: { status: "uncertain" } }
    ]);

    const candidateSet: NovelPlotCandidateSet = {
      bookId: "book-a",
      chapterCardId: "chapter-a",
      prompt: "提供剧情方向",
      sources: [source],
      candidates: [
        {
          id: "candidate-a",
          model: "unknown",
          body: "候选方案",
          createdAt: "2026-10-11T00:00:00.000Z"
        }
      ]
    };
    expect(
      candidateSetIsCurrent(candidateSet, "book-a", "chapter-a", [
        { ...source, sha256: "b".repeat(64) }
      ])
    ).toBe(false);

    const withSelectedOutline: NovelPlotCandidateSet = {
      ...candidateSet,
      outlineSelection: {
        version: "outline-v1",
        sha256: "a".repeat(64),
        status: "current"
      }
    };
    expect(
      candidateSetIsCurrent(
        withSelectedOutline,
        "book-a",
        "chapter-a",
        [source],
        {
          version: "outline-v2",
          sha256: "b".repeat(64),
          status: "current"
        }
      )
    ).toBe(false);
  });
});
