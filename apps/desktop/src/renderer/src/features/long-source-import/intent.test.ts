import { describe, expect, it } from "vitest";
import { detectLongSourceImportIntent } from "./intent";

describe("long source import intent", () => {
  it.each([
    ["把这份总稿导入新书", "attach-source"],
    ["接入这份人物设定作为参考", "attach-source"],
    ["帮我把旧人设纳入资料，先列冲突", "attach-source"],
    ["把这个文件夹接入新书，作为参考资料", "attach-source"],
    ["连接我的资料库", "attach-source"],
    ["把本次讨论保存为候选大纲", "save-discussion-outline"],
    ["整理当前讨论，生成候选大纲", "save-discussion-outline"]
  ])("detects explicit intent in %s", (message, kind) => {
    expect(detectLongSourceImportIntent(message)?.kind).toBe(kind);
  });

  it.each([
    "讨论一下人物关系",
    "我有一份大纲想聊聊",
    "帮我看看人设",
    "不要导入这个文件夹，先讨论",
    "先别保存本次讨论为大纲"
  ])(
    "does not treat ordinary discussion as an import request: %s",
    (message) => {
      expect(detectLongSourceImportIntent(message)).toBeUndefined();
    }
  );
});
