import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchPrepared, WorkbenchTask } from "@deepwrite/contracts";
import {
  makeNovelCandidateSet,
  novelCandidatePrompt,
  novelReviewPrompt,
  parseNovelReview,
  prepareNovelRun
} from "./agent-runtime";
import type { NovelChapterSource } from "./sources";

const bookId = "book_test";
const chapterCardId = "chapter_test";
const sourceBase = {
  bookId,
  path: "chapters/01/body.md",
  updatedAt: "2026-10-11T00:00:00.000Z",
  sha256: "a".repeat(64)
};
const sources: NovelChapterSource[] = [
  {
    ...sourceBase,
    fileId: "bookline",
    content: "作品主线",
    role: "bookLine",
    outlineState: "not-applicable"
  },
  {
    ...sourceBase,
    fileId: "chapter-card",
    content: "章节规划卡",
    role: "outline",
    outlineState: "selected-current",
    outlineVersion: "author-picked-v2"
  },
  {
    ...sourceBase,
    fileId: "chapter-body",
    content: "我不去。",
    role: "draft",
    outlineState: "not-applicable"
  }
];
const prepared: WorkbenchPrepared = {
  id: "prepared_test",
  bookId,
  title: "测试作品",
  indexUpdatedAt: "2026-10-11T00:00:00.000Z",
  chapterCardId,
  sources: sources.map(({ fileId, path, sha256, content }) => ({
    fileId,
    title: path.split("/").at(-1) ?? fileId,
    path,
    sha256,
    content
  })),
  agentsMd: "",
  createdAt: "2026-10-11T00:00:00.000Z"
};

function task(content: string): WorkbenchTask {
  return {
    id: "task_test",
    bookId,
    preparedId: prepared.id,
    requestKey: "request_test",
    modelId: "model_test",
    actualModel: "model-test-v1",
    purpose: "review",
    status: "completed",
    prompt: "",
    content,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    sessionId: "session_test",
    sources: prepared.sources.map(({ content: _content, ...source }) => source)
  };
}

describe("novel collaboration runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("prepares the exact chapter and verifies book-line, card, draft, and hashes", async () => {
    const request = vi.fn().mockResolvedValue({ kind: "prepared", prepared });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { deepwrite: { workbenchCollaboration: { request } } }
    });

    await expect(
      prepareNovelRun(bookId, chapterCardId, sources)
    ).resolves.toEqual(prepared);
    expect(request).toHaveBeenCalledWith({
      operation: "prepare",
      bookId,
      chapterCardId,
      fileIds: ["bookline", "chapter-card", "chapter-body"]
    });
  });

  it("rejects foreign or changed sources returned by Main preparation", async () => {
    const request = vi.fn().mockResolvedValue({
      kind: "prepared",
      prepared: {
        ...prepared,
        sources: [{ ...prepared.sources[0]!, sha256: "b".repeat(64) }]
      }
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { deepwrite: { workbenchCollaboration: { request } } }
    });

    await expect(
      prepareNovelRun(bookId, chapterCardId, sources)
    ).rejects.toThrow("准备阶段发现资料版本变化");
  });

  it("tells models whether the chapter card is an author-selected outline", () => {
    const context = "作者明确选定的本章大纲版本为「author-picked-v2」。";
    expect(novelReviewPrompt(prepared, "主角拒绝邀请", context)).toContain(
      context
    );
    expect(novelCandidatePrompt(prepared, "怎样留下悬念？", context)).toContain(
      context
    );
  });

  it("accepts exact draft evidence and rejects evidence from planning sources", () => {
    const valid = parseNovelReview(
      task(
        JSON.stringify({
          checks: [
            {
              id: "req-1",
              requirement: "主角拒绝邀请",
              kind: "must-appear",
              status: "supported",
              evidence: [
                {
                  fileId: "chapter-body",
                  start: 0,
                  end: 3,
                  quote: "我不去",
                  explanation: "原文明确拒绝。"
                }
              ]
            }
          ]
        })
      ),
      bookId,
      chapterCardId,
      sources
    );
    expect(valid.checks[0]?.status).toBe("supported");

    expect(() =>
      parseNovelReview(
        task(
          JSON.stringify({
            checks: [
              {
                id: "req-2",
                requirement: "主角拒绝邀请",
                kind: "must-appear",
                status: "supported",
                evidence: [
                  {
                    fileId: "chapter-card",
                    start: 0,
                    end: 5,
                    quote: "章节规划卡",
                    explanation: "规划里写了。"
                  }
                ]
              }
            ]
          })
        ),
        bookId,
        chapterCardId,
        sources
      )
    ).toThrow("未准备的文件或缺少原文位置");
  });

  it("keeps model candidates as discussion records with the selected outline version", () => {
    const result = makeNovelCandidateSet(
      bookId,
      chapterCardId,
      "留下悬念",
      sources,
      [task("候选剧情")],
      new Map(),
      {
        version: "author-picked-v2",
        sha256: "a".repeat(64),
        status: "current"
      }
    );
    expect(result.outlineSelection?.version).toBe("author-picked-v2");
    expect(result.candidates[0]?.body).toBe("候选剧情");
    expect("checks" in result).toBe(false);
  });
});
