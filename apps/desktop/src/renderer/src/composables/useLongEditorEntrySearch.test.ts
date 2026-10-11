import { describe, expect, it } from "vitest";
import type { LongSearchHit } from "@deepwrite/contracts";
import { longEntrySearchResults } from "./useLongEditorEntrySearch";

function hit(fileId: string, title: string, snippet: string): LongSearchHit {
  return {
    fileId,
    title,
    snippet,
    path: `plot/${fileId}.md`,
    root: "plot_design",
    start: 1,
    end: 2
  };
}

describe("longEntrySearchResults", () => {
  it("shows one jump target per matching entry", () => {
    expect(
      longEntrySearchResults([
        hit("chapter-a", "第一章 · 章卡", "第一次命中"),
        hit("chapter-a", "第一章 · 章卡", "第二次命中"),
        hit("chapter-b", "第二章 · 章卡", "   风雨   将至  ")
      ])
    ).toEqual([
      { id: "chapter-a", title: "第一章 · 章卡", detail: "第一次命中" },
      { id: "chapter-b", title: "第二章 · 章卡", detail: "风雨 将至" }
    ]);
  });
});
