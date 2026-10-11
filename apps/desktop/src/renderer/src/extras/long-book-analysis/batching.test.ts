import { describe, expect, it } from "vitest";
import type {
  LongBookAnalysisChapter,
  LongBookAnalysisNote,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import {
  buildAnalysisSegments,
  estimateAnalysisTokens,
  groupAnalysisNotes,
  groupAnalysisSegments,
  resolveAnalysisInputBudget,
  splitAnalysisNotesForBudget
} from "./batching";

const model = {
  id: "model-1",
  contextWindow: 100_000,
  maxTokens: 16_000
} as ModelConfig;

function chapter(order: number, text: string): LongBookAnalysisChapter {
  return {
    id: `chapter-${order}`,
    order,
    title: `第 ${order} 章`,
    sourceName: `${order}.txt`,
    text,
    charCount: text.length
  };
}

describe("long-book analysis batching", () => {
  it("uses the documented mixed Chinese and ASCII token estimate", () => {
    expect(estimateAnalysisTokens("中文ABCD")).toBe(4);
  });

  it("deducts prompt and output reserves before applying the 60% budget", () => {
    expect(resolveAnalysisInputBudget(model, "中".repeat(1_000))).toBe(47_100);
  });

  it("splits an oversized chapter while preserving chapter ownership", () => {
    const segments = buildAnalysisSegments(
      [chapter(1, "中".repeat(10_000))],
      3_000
    );
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.chapterId === "chapter-1")).toBe(
      true
    );
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "中".repeat(10_000)
    );
  });

  it("groups consecutive segments and notes within the input budget", () => {
    const segments = buildAnalysisSegments(
      [chapter(1, "甲".repeat(2_000)), chapter(2, "乙".repeat(2_000))],
      4_000
    );
    expect(groupAnalysisSegments(segments, 4_000).length).toBeGreaterThan(1);
    const notes: LongBookAnalysisNote[] = [1, 2, 3].map((order) => ({
      id: `note-${order}`,
      label: `笔记 ${order}`,
      chapterStart: order,
      chapterEnd: order,
      text: "中".repeat(1_000)
    }));
    expect(
      groupAnalysisNotes(notes, 3_100).map((group) => group.length)
    ).toEqual([2, 1]);
    expect(
      splitAnalysisNotesForBudget(notes.slice(0, 1), 1_000).length
    ).toBeGreaterThan(1);
  });
});
