import { describe, expect, it } from "vitest";
import type { LongBookAnalysisChapter } from "@deepwrite/contracts/renderer";
import {
  mergeAnalysisChapter,
  moveAnalysisChapter,
  renameAnalysisChapter,
  splitAnalysisChapter
} from "./chapter-editing";

function chapters(): LongBookAnalysisChapter[] {
  return [
    {
      id: "chapter-1",
      order: 1,
      title: "第一章",
      sourceName: "1.txt",
      text: "前半段。\n后半段。",
      charCount: 8
    },
    {
      id: "chapter-2",
      order: 2,
      title: "第二章",
      sourceName: "2.txt",
      text: "第二章正文。",
      charCount: 6
    }
  ];
}

describe("long-book analysis chapter correction", () => {
  it("renames and reorders with contiguous chapter numbers", () => {
    const renamed = renameAnalysisChapter(chapters(), "chapter-1", "新的开篇");
    const moved = moveAnalysisChapter(renamed, "chapter-2", 0);
    expect(moved.map(({ order, title }) => ({ order, title }))).toEqual([
      { order: 1, title: "第二章" },
      { order: 2, title: "新的开篇" }
    ]);
  });

  it("splits at the cursor and merges without losing body text", () => {
    const original = chapters();
    const cursor = original[0]!.text.indexOf("后半段");
    const split = splitAnalysisChapter(original, "chapter-1", cursor);
    expect(split).toHaveLength(3);
    const merged = mergeAnalysisChapter(split, split[0]!.id, "next");
    expect(merged).toHaveLength(2);
    expect(merged[0]!.text.replace(/\s/gu, "")).toBe(
      original[0]!.text.replace(/\s/gu, "")
    );
    expect(merged.map((chapter) => chapter.order)).toEqual([1, 2]);
  });
});
