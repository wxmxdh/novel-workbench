import { describe, expect, it } from "vitest";
import type {
  LongBookSummary,
  LongLedgerCommitIndexEntry
} from "@deepwrite/contracts";
import { longContinuityBatchLabel } from "./longContinuityBatchLabel";

describe("longContinuityBatchLabel", () => {
  it("shows the chapter range and member count for a batch", () => {
    const commit = {
      id: "commit_batch",
      mode: "text_files_batch",
      sequence: 3,
      chapterCardId: "chapter_two",
      chapterCardIds: ["chapter_one", "chapter_two"],
      checkpointChapterCardId: "chapter_two"
    } as LongLedgerCommitIndexEntry;
    const chapters = [
      { id: "chapter_one", title: "雨夜来信" },
      { id: "chapter_two", title: "旧邮戳" }
    ] as LongBookSummary["navigation"]["chapterCards"];

    expect(longContinuityBatchLabel(commit, chapters)).toEqual({
      label: "雨夜来信 — 旧邮戳",
      badge: "2 章 · 记录 3"
    });
  });
});
