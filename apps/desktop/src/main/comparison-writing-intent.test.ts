import { describe, expect, it } from "vitest";
import {
  chapterNumber,
  comparisonWritingIntent,
  parallelWritingRequest
} from "./comparison-writing-intent";

describe("comparison writing intent", () => {
  it("recognizes a parallel writing action following local corrections", () => {
    const text =
      "1.徐\n2.重点班\n3.太夸张了，这个物理白描\n4.后面的我们再商量。\n然后你同时推几个创作团队来分别创作吧";
    expect(parallelWritingRequest(text)).toBe(
      "然后你同时推几个创作团队来分别创作吧"
    );
  });
  it.each([
    "不要让几个模型分别创作",
    "能否让几个模型分别创作？",
    "讨论并行写作团队的功能",
    "只讨论，别让团队分别写正文",
    "让团队并行写第一章大纲",
    "第一章先让团队写个大纲"
  ])("does not authorize from %s", (text) => {
    expect(parallelWritingRequest(text)).toBeUndefined();
  });
  it("allows body writing from an already selected outline in the parallel channel", () => {
    expect(
      parallelWritingRequest("按已选大纲让团队并行写第一章正文")
    ).toBe("按已选大纲让团队并行写第一章正文");
  });
  it.each([
    ["写第1章", 1],
    ["请现在写第001章初稿", 1],
    ["按我们选定的大纲写第一卷第1章", 1],
    ["第一章按选好的大纲写一稿", 1],
    ["第一章先行，第一章写两份独立稿", 1],
    ["第一章写两份独立稿", 1],
    ["第一章先写两份正文", 1],
    ["请按已选大纲给我写一份第一章草稿", 1],
    ["写一稿第一章，按已选大纲", 1],
    ["按我们选定的大纲撰写第十章", 10],
    ["开始撰写第十章正文", 10],
    ["生成第两百章草稿", 200],
    ["主模型单独写第二章正文", 2]
  ])("recognizes direct request %s", (text, chapter) => {
    expect(comparisonWritingIntent(text)?.chapter).toBe(chapter);
  });

  it("keeps an explicit writer count on chapter-first requests", () => {
    expect(comparisonWritingIntent("第一章写两份独立稿")).toMatchObject({
      chapter: 1,
      writerCount: 2
    });
    expect(
      comparisonWritingIntent("第一章先行，第一章分别写两份正文"),
      "第一章先行，第一章分别写两份正文"
    ).toMatchObject({ chapter: 1, writerCount: 2 });
  });

  it.each([
    "讨论一下写第1章的功能",
    "不要写第1章",
    "先不写第1章，先选大纲",
    "这个按钮可以写第1章吗",
    "第一章已经写完了",
    "第一章是谁写的",
    "第一章写两份可以吗？",
    "写第一章大纲",
    "第一章先写个大纲",
    "让团队写第一章的大纲"
  ])(
    "does not treat discussion or non-supported phrasing as authorization: %s",
    (text) => {
      expect(comparisonWritingIntent(text)).toBeUndefined();
    }
  );

  it("parses bounded chapter numbers", () => {
    expect(chapterNumber("第九十九章")).toBe(99);
    expect(chapterNumber("第100001章")).toBe(100001);
    expect(comparisonWritingIntent("写第100001章")).toBeUndefined();
  });
  it.each([
    "重试 DeepSeek 和 Gemini 2.5 的第一章独立稿，保留已经保存的其他稿件。",
    "请补跑第一章对照稿，不要覆盖其他稿件。",
    "重新写第一章，保留原稿。",
    "让 DeepSeek 重新写第一章正文",
    "重试第一章独立稿。其他地方有什么问题吗？",
    "1.保留旧稿\n2.请重试 Gemini 的第一章独立稿"
  ])("recognizes scoped writing retries without magic wording: %s", (text) => {
    expect(comparisonWritingIntent(text)?.chapter).toBe(1);
    expect(text).toContain(comparisonWritingIntent(text)!.quote);
  });
  it.each([
    "不要重试第一章独立稿",
    "能否重试第一章独立稿？",
    "重试第一章独立稿可以吗？",
    "重试第一章的审核",
    "比如重试第一章独立稿",
    "> 重试第一章独立稿",
    "```text\n重试第一章独立稿\n```",
    "只讨论为何重试第一章独立稿失败"
  ])(
    "does not authorize from review, refusal or quoted example: %s",
    (text) => {
      expect(comparisonWritingIntent(text)).toBeUndefined();
    }
  );
});
