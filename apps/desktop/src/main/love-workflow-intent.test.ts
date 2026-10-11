import { describe, expect, it } from "vitest";
import {
  loveFailureContinuationIntent,
  loveLocalRevisionIntent,
  loveRedraftIntent,
  loveWorkflowActionAuthorized,
  loveWorkflowAnnotationContextAuthorized,
  loveWritingAuthorizationRevoked
} from "./love-workflow-intent";

describe("LOVE author workflow actions", () => {
  it("accepts natural local changes while preserving other passages", () => {
    expect(
      loveLocalRevisionIntent("按批注修改第二章正文，其他地方不要改")?.chapter
    ).toBe(2);
    expect(loveLocalRevisionIntent("请扩展这句环境描写")?.quote).toBe(
      "请扩展这句环境描写"
    );
    expect(
      loveLocalRevisionIntent("按审阅意见局部修订第一章正文")?.chapter
    ).toBe(1);
  });
  it("does not convert review discussion, quotes, or feature requests into prose authority", () => {
    for (const text of [
      "请给第二章修改意见",
      "先不修改正文",
      "不能按批注修改第二章正文",
      "别按批注修改第二章正文",
      "我不想按批注修改第二章正文",
      "不需要按批注修改第二章正文",
      "要不要按批注修改第二章正文",
      "按批注修改第二章正文可以吗？",
      "你觉得按批注修改第二章正文吗",
      "如果按批注修改正文呢",
      "程序需要支持按批注修改正文",
      "> 按批注修改正文",
      "```按批注修改正文```",
      "只讨论怎么修改这句"
    ]) {
      expect(loveLocalRevisionIntent(text)).toBeUndefined();
    }
  });
  it("recognizes explicit secondary creation instead of guessing from a mentioned base", () => {
    expect(
      loveRedraftIntent("让团队按底稿和批注进行第二章二次创作")?.chapter
    ).toBe(2);
    expect(
      loveRedraftIntent("我们现在在那个大纲和GPT底板的基础上进行二次创作")
        ?.quote
    ).toContain("二次创作");
    for (const text of [
      "讨论一下底稿",
      "如果让模型按底稿再创作",
      "不要按底稿重写",
      "不能按底稿进行第二章再创作",
      "这次不是让你按底稿重写第二章",
      "你觉得按底稿进行第二章再创作吗",
      "这个功能要支持按底稿重写"
    ])
      expect(loveRedraftIntent(text)).toBeUndefined();
  });
  it("separates selecting a base and binding existing notes from discussion", () => {
    expect(
      loveWorkflowActionAuthorized("就用这份稿作为底稿", "select_draft")
    ).toBe(true);
    expect(loveWorkflowActionAuthorized("去看我的批注", "attach_notes")).toBe(
      false
    );
    expect(
      loveWorkflowActionAuthorized("采用某稿的流程怎么做", "select_draft")
    ).toBe(false);
    expect(
      loveWorkflowActionAuthorized("暂不采用这份底稿", "select_draft")
    ).toBe(false);
    for (const text of [
      "不能采用这份稿作为底稿",
      "别采用这份稿作为底稿",
      "要不要选用这份稿作为底稿",
      "你觉得采用这份稿作为底稿吗",
      "采用这份稿吗？",
      "采用这份稿吗，然后继续讨论",
      "采用这种说法",
      "我采用了你的说法"
    ])
      expect(loveWorkflowActionAuthorized(text, "select_draft"), text).toBe(
        false
      );
  });
  it("requires annotation adoption intent, and treats continuation wording as a pointer only", () => {
    expect(
      loveWorkflowActionAuthorized("按这两条批注修改第一章正文", "attach_notes")
    ).toBe(true);
    expect(
      loveWorkflowActionAuthorized("采用这两条批注作为修订依据", "attach_notes")
    ).toBe(true);
    for (const text of ["去看我的批注", "绑定第一章批注", "批注读取怎么做"])
      expect(loveWorkflowActionAuthorized(text, "attach_notes")).toBe(false);
    expect(
      loveWorkflowActionAuthorized("采用第1、第2条", "attach_notes")
    ).toBe(true);
    expect(
      loveWorkflowActionAuthorized("采用第1条和第2条", "attach_notes")
    ).toBe(true);
    for (const text of [
      "采用第一条大纲",
      "采用第1条规则",
      "采用第1条设定",
      "采用第1条说法",
      "采用第1条正文",
      "采用第1、第2条吗？",
      "讨论一下采用第1、第2条",
      "> 采用第1、第2条"
    ])
      expect(loveWorkflowActionAuthorized(text, "attach_notes"), text).toBe(
        false
      );
    expect(
      loveWorkflowAnnotationContextAuthorized("去看我的批注")
    ).toBe(true);
    expect(
      loveWorkflowAnnotationContextAuthorized("绑定第一章批注")
    ).toBe(true);
    expect(
      loveWorkflowAnnotationContextAuthorized("请读取批注，只作背景讨论")
    ).toBe(true);
    for (const text of [
      "我已经批注了",
      "不要绑定我的批注",
      "能否读取第一章批注？"
    ])
      expect(loveWorkflowAnnotationContextAuthorized(text), text).toBe(false);

    expect(loveFailureContinuationIntent("继续失败的两份")).toMatchObject({
      writerCount: 2
    });
    expect(
      loveFailureContinuationIntent(
        "继续失败的两份，保留成功稿，不要重写其他稿"
      )
    ).toMatchObject({ writerCount: 2 });
    expect(
      loveFailureContinuationIntent("继续失败的第一章两份")
    ).toMatchObject({ chapter: 1, writerCount: 2 });
    for (const text of [
      "能否继续失败的两份？",
      "不要继续失败的两份",
      "讨论如何继续失败的两份",
      "> 继续失败的两份"
    ])
      expect(loveFailureContinuationIntent(text)).toBeUndefined();
    expect(loveWritingAuthorizationRevoked("撤销第一章写作授权")).toBe(true);
    expect(loveWritingAuthorizationRevoked("停止之前写作任务")).toBe(true);
    expect(
      loveWritingAuthorizationRevoked("保留成功稿，不要重写其他稿")
    ).toBe(false);
    expect(loveWritingAuthorizationRevoked("继续失败的两份")).toBe(false);
  });
});
