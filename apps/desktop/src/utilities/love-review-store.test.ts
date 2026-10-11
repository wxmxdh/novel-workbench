import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LongPrepareLoveReviewInput,
  LongSubmitLoveReviewInput,
  LoveReviewReport
} from "@deepwrite/contracts";
import {
  prepareLoveReviewAtRoot,
  submitLoveReviewAtRoot,
  type NativeReviewSources
} from "./love-review-store";
import { reviewHash } from "./love-review-files";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const native: NativeReviewSources = {
  chapter: 1,
  volume: "第一卷",
  cardPath: "long/chapters/current/card.md",
  cardContent: "场次一：入座。场次二：填表。",
  bodyPath: "long/chapters/current/body.md",
  bodyContent: "新合稿正文。",
  evidence: "宋子凡的视角。允许正常的少年心理，局部意见保持局部。"
};
const runtime = {
  mode: "provider" as const,
  configId: "fixture-runtime",
  provider: "custom",
  model: "fixture-model"
};
const report: LoveReviewReport = {
  status: "reviewed",
  summary: "已按本轮明确范围审阅，不代表文学通过。",
  reviewedSourceIds: [
    "draft-1",
    "draft-2",
    "draft-3",
    "draft-4",
    "native-current",
    "selected-outline",
    "chapter-card",
    "author-request"
  ],
  missingSources: [],
  findings: [
    {
      id: "view-01",
      category: "literary-suggestion",
      scope: "第1章这一句",
      issue: "这句可保留，也可以减少重复。",
      sourceId: "draft-1",
      quote: "我又看了他一眼。"
    }
  ]
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "love-review-store-"));
  roots.push(root);
  await mkdir(join(root, ".novel/deliveries"), { recursive: true });
  await mkdir(join(root, "004_写作中"));
  const outline = `---\nversion: native-fixture\n---\n${native.cardContent}`;
  await writeFile(join(root, ".novel/outline.md"), outline);
  await writeFile(
    join(root, ".novel/chapter-state.json"),
    JSON.stringify({
      chapters: [
        {
          chapter: 1,
          volume: "第一卷",
          selected_outline: {
            path: ".novel/outline.md",
            hash: reviewHash(outline)
          }
        }
      ]
    })
  );
  for (const [index, model] of [
    "model-a",
    "model-b",
    "model-c",
    "model-d"
  ].entries()) {
    const content = `---\nchapter: 1\nvolume: "第一卷"\nmodel: ${model}\n---\n我又看了他一眼。${index}`;
    const path = `004_写作中/draft-${model}.md`;
    await writeFile(join(root, path), content);
    await writeFile(
      join(root, `.novel/deliveries/${model}.json`),
      JSON.stringify({
        artifact: { path, hash: reviewHash(content) },
        identity: { model_raw: model },
        created_at: `2026-01-01T00:00:0${index}Z`
      })
    );
  }
  const request: LongPrepareLoveReviewInput = {
    bookId: "longbook_9a146bbe",
    targetKind: "drafts",
    reviewerIds: ["love-viewpoint", "love-outline"],
    authorText: "看看第一章四份当前稿，意见保持局部。"
  };
  return { root, sessionId: "fixture-session", request, native: { ...native } };
}

describe("LOVE review source and completion gates", () => {
  it("retries a subset of the frozen members without dropping already registered reports or shrinking coverage", async () => {
    const f = await fixture();
    const snapshot = await prepareLoveReviewAtRoot(f);
    await submitLoveReviewAtRoot({
      ...f,
      request: {
        bookId: "longbook_9a146bbe",
        reviewId: snapshot.reviewId,
        reviewerId: "love-outline",
        phase: "specialist",
        targetSetSha256: snapshot.targetSetSha256,
        report,
        runtime
      }
    });
    const retry = await prepareLoveReviewAtRoot({
      ...f,
      request: {
        ...f.request,
        reviewId: snapshot.reviewId,
        reviewerIds: ["love-viewpoint"]
      }
    });
    expect(retry.reviewerIds).toEqual(snapshot.reviewerIds);
    expect(retry.coverage).toMatchObject({
      expectedCount: 2,
      completedCount: 1,
      missingReviewerIds: ["love-viewpoint"]
    });
    expect(retry.reports.map((r) => r.reviewerId)).toEqual(["love-outline"]);
    await expect(
      prepareLoveReviewAtRoot({
        ...f,
        request: {
          ...f.request,
          reviewId: snapshot.reviewId,
          reviewerIds: ["love-research"]
        }
      })
    ).rejects.toThrow("成员范围变化");
  });
  it("marks a draft batch stale if the selected target set gains a newly delivered draft", async () => {
    const f = await fixture();
    const snapshot = await prepareLoveReviewAtRoot(f);
    const content = `---\nchapter: 1\nvolume: "第一卷"\nmodel: model-extra\n---\n新增的第五份稿。`;
    const path = "004_写作中/draft-model-extra.md";
    await writeFile(join(f.root, path), content);
    await writeFile(
      join(f.root, ".novel/deliveries/model-extra.json"),
      JSON.stringify({
        artifact: { path, hash: reviewHash(content) },
        identity: { model_raw: "model-extra" },
        created_at: "2026-10-05T00:00:00.000Z"
      })
    );
    await expect(
      prepareLoveReviewAtRoot({
        ...f,
        request: { ...f.request, reviewId: snapshot.reviewId }
      })
    ).rejects.toThrow("正文或依据版本已变化");
  });
  it("reads all four actual delivered drafts despite an empty native body", async () => {
    const f = await fixture();
    f.native.bodyContent = "";
    const snapshot = await prepareLoveReviewAtRoot(f);
    expect(snapshot.targets).toHaveLength(4);
    expect(
      snapshot.targets.every((target) =>
        target.content.includes("我又看了他一眼。")
      )
    ).toBe(true);
    expect(
      snapshot.sources.find(({ id }) => id === "author-request")?.content
    ).toBe(f.request.authorText);
    expect(snapshot.coverage.state).toBe("incomplete");
    expect(
      await readFile(
        join(f.root, `.novel/reviews/${snapshot.reviewId}/manifest.json`),
        "utf8"
      )
    ).toContain(snapshot.targetSetSha256);
  });
  it("rejects unregistered/changed/outside targets instead of falling back to a same-name old project", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "004_写作中/draft-model-a.md"), "changed");
    await expect(prepareLoveReviewAtRoot(f)).rejects.toThrow(
      /版本已变化|没有可读/
    );
    await expect(
      prepareLoveReviewAtRoot({
        ...f,
        request: { ...f.request, targetPaths: ["../What Is Love/draft.md"] }
      })
    ).rejects.toThrow();
  });
  it("does not treat lifecycle completion or a missing-source report as review completion", async () => {
    const f = await fixture();
    const snapshot = await prepareLoveReviewAtRoot(f);
    const request: LongSubmitLoveReviewInput = {
      bookId: "longbook_9a146bbe",
      reviewId: snapshot.reviewId,
      reviewerId: "love-viewpoint",
      phase: "specialist",
      targetSetSha256: snapshot.targetSetSha256,
      runtime,
      report: {
        ...report,
        status: "incomplete",
        findings: [],
        missingSources: ["四份正文未取得"]
      }
    };
    const result = await submitLoveReviewAtRoot({ ...f, request });
    expect(result).toMatchObject({
      state: "incomplete",
      completedCount: 0,
      expectedCount: 2
    });
    await expect(
      submitLoveReviewAtRoot({
        ...f,
        request: {
          ...request,
          report: { ...request.report, status: "reviewed" }
        }
      })
    ).rejects.toThrow(/缺读/);
  });
  it("rejects reconstructed quotes and unknown report links", async () => {
    const f = await fixture();
    const snapshot = await prepareLoveReviewAtRoot(f);
    const request: LongSubmitLoveReviewInput = {
      bookId: "longbook_9a146bbe",
      reviewId: snapshot.reviewId,
      reviewerId: "love-viewpoint",
      phase: "specialist",
      targetSetSha256: snapshot.targetSetSha256,
      runtime,
      report: {
        ...report,
        findings: [{ ...report.findings[0]!, quote: "主模型重构出的原句" }]
      }
    };
    await expect(submitLoveReviewAtRoot({ ...f, request })).rejects.toThrow(
      /引文/
    );
    await expect(
      submitLoveReviewAtRoot({
        ...f,
        request: {
          ...request,
          report: {
            ...report,
            findings: [
              { ...report.findings[0]!, reportId: "nonexistent:specialist" }
            ]
          }
        }
      })
    ).rejects.toThrow(/不存在/);
  });
  it("requires every requested specialist and the actual main summary before independent review", async () => {
    const f = await fixture();
    const snapshot = await prepareLoveReviewAtRoot(f);
    const base = {
      bookId: "longbook_9a146bbe" as const,
      reviewId: snapshot.reviewId,
      targetSetSha256: snapshot.targetSetSha256,
      runtime,
      report
    };
    const submit = (
      reviewerId: string,
      phase: LongSubmitLoveReviewInput["phase"]
    ) =>
      submitLoveReviewAtRoot({
        ...f,
        request: {
          ...base,
          reviewerId,
          phase,
          report: {
            ...report,
            reviewedSourceIds: [
              ...report.reviewedSourceIds,
              ...(phase === "independent"
                ? [
                    "main-summary",
                    "love-viewpoint:specialist",
                    "love-outline:specialist"
                  ]
                : [])
            ]
          }
        }
      });
    expect((await submit("love-viewpoint", "specialist")).state).toBe(
      "incomplete"
    );
    await expect(submit("love-intent", "independent")).rejects.toThrow(
      /尚未取得/
    );
    expect((await submit("love-outline", "specialist")).state).toBe(
      "needs_independent_review"
    );
    await expect(submit("love-intent", "independent")).rejects.toThrow(
      /实际主汇总/
    );
    await submit("main", "summary");
    expect(await submit("love-intent", "independent")).toMatchObject({
      state: "ready",
      independentFindingCount: 1
    });
    expect((await submit("main", "summary")).state).toBe(
      "needs_independent_review"
    );
  });
  it("persists reports across turns and refuses a changed source version", async () => {
    const f = await fixture();
    const snapshot = await prepareLoveReviewAtRoot(f);
    const load = {
      ...f,
      request: {
        ...f.request,
        reviewId: snapshot.reviewId,
        authorText: "继续检查汇总。"
      }
    };
    expect((await prepareLoveReviewAtRoot(load)).reviewId).toBe(
      snapshot.reviewId
    );
    await expect(
      prepareLoveReviewAtRoot({ ...load, sessionId: "other-session" })
    ).rejects.toThrow(/会话/);
    f.native.cardContent += "新增场次。";
    await expect(prepareLoveReviewAtRoot(load)).rejects.toThrow(/版本已变化/);
    const stored = JSON.parse(
      await readFile(
        join(f.root, `.novel/reviews/${snapshot.reviewId}/manifest.json`),
        "utf8"
      )
    );
    expect(stored.snapshot.coverage.state).toBe("stale");
  });
  it("gives a new merged body a new review identity instead of inheriting draft completion", async () => {
    const f = await fixture();
    const drafts = await prepareLoveReviewAtRoot(f);
    const merged = await prepareLoveReviewAtRoot({
      ...f,
      request: { ...f.request, targetKind: "chapter_body" }
    });
    expect(merged.targetSetSha256).not.toBe(drafts.targetSetSha256);
    expect(merged.reports).toEqual([]);
    expect(merged.coverage.state).toBe("incomplete");
    f.native.bodyContent = "";
    await expect(
      prepareLoveReviewAtRoot({
        ...f,
        request: { ...f.request, targetKind: "chapter_body" }
      })
    ).rejects.toThrow(/正文为空/);
  });

  it("permits reviewing a current planning card before an execution outline is registered", async () => {
    const f = await fixture();
    await rm(join(f.root, ".novel/chapter-state.json"));
    const snapshot = await prepareLoveReviewAtRoot({
      ...f,
      request: { ...f.request, targetKind: "chapter_card" }
    });
    expect(snapshot.targets[0]?.content).toBe(native.cardContent);
    expect(snapshot.sources.some(({ id }) => id === "selected-outline")).toBe(
      false
    );
    await expect(prepareLoveReviewAtRoot(f)).rejects.toThrow(
      "没有唯一已选大纲"
    );
  });
  it("invalidates the main summary when a professional report is replaced", async () => {
    const f = await fixture();
    const snapshot = await prepareLoveReviewAtRoot(f);
    const base = {
      bookId: "longbook_9a146bbe" as const,
      reviewId: snapshot.reviewId,
      targetSetSha256: snapshot.targetSetSha256,
      runtime,
      report
    };
    for (const reviewerId of snapshot.reviewerIds)
      await submitLoveReviewAtRoot({
        ...f,
        request: { ...base, reviewerId, phase: "specialist" }
      });
    await submitLoveReviewAtRoot({
      ...f,
      request: { ...base, reviewerId: "main", phase: "summary" }
    });
    await submitLoveReviewAtRoot({
      ...f,
      request: {
        ...base,
        reviewerId: "love-outline",
        phase: "specialist",
        report: { ...report, summary: "新报告" }
      }
    });
    const loaded = await prepareLoveReviewAtRoot({
      ...f,
      request: { ...f.request, reviewId: snapshot.reviewId }
    });
    expect(loaded.reports.some((entry) => entry.phase === "summary")).toBe(
      false
    );
    await expect(
      submitLoveReviewAtRoot({
        ...f,
        request: {
          ...base,
          reviewerId: "main",
          phase: "summary",
          report: { ...report, reviewedSourceIds: ["invented"] }
        }
      })
    ).rejects.toThrow("未提供");
    await expect(
      prepareLoveReviewAtRoot({
        ...f,
        request: {
          ...f.request,
          reviewId: snapshot.reviewId,
          targetKind: "chapter_body"
        }
      })
    ).rejects.toThrow("范围变化");
  });
});
