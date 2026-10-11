import { describe, expect, it } from "vitest";
import type { LongSourceFolder } from "@deepwrite/contracts";
import {
  localSourceRequest,
  localSourceRequestForConversation
} from "./localSourceRequest";
import { detectLongSourceImportIntent } from "../features/long-source-import/intent";

describe("local source request routing", () => {
  it("opens the picker for a quoted path with spaces, but lets connected sources reach the agent", () => {
    const folder = {
      rootPath: "D:\\Example Project\\资料"
    } as LongSourceFolder;
    const prompt = '请读取 "D:\\Example Project\\资料\\人物.md"';
    expect(localSourceRequest(prompt)).toEqual({
      suggestedPath: "D:\\Example Project\\资料\\人物.md"
    });
    expect(localSourceRequest(prompt, [folder])).toBeUndefined();
    expect(
      localSourceRequest('读取 "D:\\Example Project\\资料2\\人物.md"', [folder])
    ).toBeDefined();
  });
  it("respects a negative request and does not intercept normal book discussion", () => {
    expect(localSourceRequest('不要读取 "D:\\Example\\资料"')).toBeUndefined();
    expect(localSourceRequest("看看人物关系有没有问题")).toBeUndefined();
    expect(localSourceRequest("读取我电脑上的资料库")).toEqual({});
  });

  it("stops an unquoted Markdown path before flattened handoff text", () => {
    expect(
      localSourceRequest(
        "请读取 D:\\Example Project\\第001章_批注.md被批注原稿：D:\\Example Project\\第001章_正文.md"
      )
    ).toEqual({
      suggestedPath: "D:\\Example Project\\第001章_批注.md"
    });
  });

  it("routes a generated LOVE handoff and natural chapter annotation request through Main", () => {
    const loveBookId = "longbook_9a146bbe";
    const root =
      "D:/AI/Claude Code/03_娱乐与创作/01_小说创作/小说/00_创作项目/项目/LOVE";
    const handoff = `作者批注回读\n项目根目录：${root}\n批注汇总：${root}/006_批注/第一卷/第001章/批注汇总.md`;

    expect(
      localSourceRequestForConversation(handoff, loveBookId, false)
    ).toBeUndefined();
    expect(
      localSourceRequestForConversation("读一下第一章批注", loveBookId, false)
    ).toBeUndefined();
  });

  it("routes real single-model, multi-model, and chapter-wide workbench prompts through Main", async () => {
    const { buildFeedbackPrompt } = await import(
      new URL(
        "../../../../../../../小说对照工作台/public/feedback-prompt.js",
        import.meta.url
      ).href
    );
    const root =
      "D:/AI/Claude Code/03_娱乐与创作/01_小说创作/小说/00_创作项目/项目/LOVE";
    const drafts = [
      {
        id: "gpt-draft",
        kind: "draft",
        model: "gpt-6.1-sol",
        relative: "004_写作中/第001章 正文草稿 gpt-6.1-sol.md",
        hash: "gpt-hash"
      },
      {
        id: "gemini-draft",
        kind: "draft",
        model: "gemini-3.1-pro",
        relative: "004_写作中/第001章 正文草稿 gemini-3.1-pro.md",
        hash: "gemini-hash"
      },
      {
        id: "opus-draft",
        kind: "draft",
        model: "opus-4.6",
        relative: "004_写作中/第001章 正文草稿 opus-4.6.md",
        hash: "opus-hash"
      }
    ];
    const notes = drafts.map((draft) => ({
      id: `${draft.id}-note`,
      model: draft.model,
      fileId: draft.id,
      fileRelative: draft.relative,
      sourceHash: draft.hash
    }));
    const selectedOutline = {
      id: "chapter-card",
      kind: "outline",
      volume: "第一卷",
      storyVolume: "第一卷",
      chapter: "001",
      relative: ".novel/native-execution/run 01/chapter-card.md",
      version: "native-4c146a202284",
      deliveryStatus: { selected: true }
    };
    const shared = {
      project: "LOVE",
      root,
      volume: "第一卷",
      chapter: "001",
      notesPath: "006_批注/第一卷/第001章/批注汇总.md",
      files: [...drafts, selectedOutline],
      activeFiles: drafts,
      notes
    };
    const prompts = [
      buildFeedbackPrompt({
        ...shared,
        modelId: "gpt-6.1-sol",
        annotation: notes[0]
      }),
      buildFeedbackPrompt({ ...shared, modelId: null }),
      buildFeedbackPrompt({
        ...shared,
        modelId: null,
        notes: notes.slice(0, 2),
        activeFiles: drafts.slice(0, 2)
      })
    ];

    expect(prompts[0]).toContain("gpt-6.1-sol_批注.md");
    expect(prompts[1]).toContain("正文草稿 gemini-3.1-pro.md");
    expect(prompts[1]).toContain("正文草稿 opus-4.6.md");
    expect(prompts[2]).toContain("批注文件：");
    for (const prompt of prompts) {
      for (const value of [prompt, prompt.replace(/\s+/gu, " ")]) {
        expect(detectLongSourceImportIntent(value)).toBeUndefined();
        expect(
          localSourceRequestForConversation(value, "longbook_9a146bbe", false)
        ).toBeUndefined();
      }
    }
  });

  it("keeps other projects, foreign paths, and explicit source imports on the picker path", () => {
    const outsidePath = "D:/OtherBook/006_批注/第一卷/第001章/批注汇总.md";
    expect(
      localSourceRequestForConversation(
        `作者批注回读\n请只读讨论 ${outsidePath}`,
        "another-book",
        false
      )
    ).toEqual({ suggestedPath: outsidePath });
    expect(
      localSourceRequestForConversation(
        `作者批注回读 第1章批注：${outsidePath}`,
        "longbook_9a146bbe",
        false
      )
    ).toEqual({ suggestedPath: outsidePath });
    expect(
      localSourceRequestForConversation(
        `读一下第一章批注 ${outsidePath}`,
        "longbook_9a146bbe",
        false
      )
    ).toEqual({ suggestedPath: outsidePath });
    expect(
      localSourceRequestForConversation(
        `读一下 What Is Love 第一章批注 ${outsidePath}`,
        "longbook_9a146bbe",
        false
      )
    ).toEqual({ suggestedPath: outsidePath });
    expect(
      localSourceRequestForConversation(
        `作者批注回读\n请把 ${outsidePath} 导入资料库`,
        "longbook_9a146bbe",
        false
      )
    ).toEqual({ suggestedPath: outsidePath });
  });

  it("preserves existing attachment and connected-folder behavior", () => {
    const folder = {
      rootPath: "D:\\Example Project\\资料"
    } as LongSourceFolder;
    expect(
      localSourceRequestForConversation(
        '请读取 "D:\\Outside\\批注.md"',
        "another-book",
        true
      )
    ).toBeUndefined();
    expect(
      localSourceRequestForConversation(
        '请读取 "D:\\Example Project\\资料\\批注.md"',
        "another-book",
        false,
        [folder]
      )
    ).toBeUndefined();
  });
});
