import { describe, expect, it } from "vitest";
import type { LongStageSourceImportInput } from "@deepwrite/contracts";
import { SourceImportPreviewRegistry } from "./source-import-preview-registry";

const input: LongStageSourceImportInput = {
  bookId: "longbook_source-test",
  title: "新书资料",
  sourceName: "总稿.md",
  content: "\uFEFF# 作者原文\r\n\r\n保留空格  \r\n",
  purpose: "foundation",
  authority: "candidate",
  expectedIndexUpdatedAt: "2026-10-03T00:00:00.000Z"
};

describe("author source preview ownership and frozen text", () => {
  it("freezes original text and metadata independently of renderer mutation", () => {
    const previews = new SourceImportPreviewRegistry();
    const draft = { ...input };
    const staged = previews.stage(1, draft);
    draft.content = "已被替换";
    draft.title = "另一书";
    const saved = previews.acquire(staged.previewId, 1, input.bookId);
    expect(saved.content).toBe(input.content);
    expect(saved.title).toBe(input.title);
    expect(staged.content).toBe(input.content);
    expect(staged.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects another window and another book without consuming the author's preview", () => {
    const previews = new SourceImportPreviewRegistry();
    const staged = previews.stage(1, input);
    expect(() => previews.acquire(staged.previewId, 2, input.bookId)).toThrow(
      "窗口或书籍"
    );
    expect(() =>
      previews.acquire(staged.previewId, 1, "longbook_other-test")
    ).toThrow("窗口或书籍");
    expect(previews.acquire(staged.previewId, 1, input.bookId).content).toBe(
      input.content
    );
  });

  it("prevents concurrent duplicate confirmations and allows retry after a rejected save", () => {
    const previews = new SourceImportPreviewRegistry();
    const staged = previews.stage(1, input);
    previews.acquire(staged.previewId, 1, input.bookId);
    expect(() => previews.acquire(staged.previewId, 1, input.bookId)).toThrow(
      "正在保存"
    );
    previews.finish(staged.previewId, false);
    expect(previews.acquire(staged.previewId, 1, input.bookId).content).toBe(
      input.content
    );
    previews.finish(staged.previewId, true);
    expect(() => previews.acquire(staged.previewId, 1, input.bookId)).toThrow(
      "失效"
    );
  });

  it("expires unused previews and clears them when their owner window closes", () => {
    let now = 0;
    const previews = new SourceImportPreviewRegistry(() => now, 100);
    const staged = previews.stage(1, input);
    now = 100;
    expect(() => previews.acquire(staged.previewId, 1, input.bookId)).toThrow(
      "失效"
    );
    const next = previews.stage(1, input);
    previews.clearForWebContents(1);
    expect(() => previews.acquire(next.previewId, 1, input.bookId)).toThrow(
      "失效"
    );
  });

  it("replaces an abandoned preview from the same window", () => {
    const previews = new SourceImportPreviewRegistry();
    const first = previews.stage(1, input);
    const second = previews.stage(1, { ...input, content: "新预览" });
    expect(() => previews.acquire(first.previewId, 1, input.bookId)).toThrow(
      "失效"
    );
    expect(previews.acquire(second.previewId, 1, input.bookId).content).toBe(
      "新预览"
    );
  });

  it("enforces nonempty text and UTF-8 byte limits", () => {
    const previews = new SourceImportPreviewRegistry();
    expect(() => previews.stage(1, { ...input, content: " \r\n" })).toThrow(
      "不能为空"
    );
    expect(() =>
      previews.stage(1, { ...input, content: "字".repeat(750_000) })
    ).toThrow("最多 2 MB");
  });
});
