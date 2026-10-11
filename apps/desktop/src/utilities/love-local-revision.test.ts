import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LoveLocalRevisionPatch } from "@deepwrite/contracts";
import { previewLoveLocalRevision } from "./love-local-revision";

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const patch = (
  oldText: string,
  newText: string,
  reason = "按作者批注调整"
): LoveLocalRevisionPatch => ({ oldText, newText, reason });

describe("previewLoveLocalRevision", () => {
  it("rejects a changed source hash before applying any patch", () => {
    expect(() =>
      previewLoveLocalRevision({
        source: "原稿已变化",
        expectedSourceSha256: sha("旧稿"),
        patches: [patch("原稿", "修订稿")]
      })
    ).toThrow("底稿版本已变化");
  });

  it("requires an explicit occurrence when the target sentence repeats", () => {
    expect(() =>
      previewLoveLocalRevision({
        source: "相同句。中间。相同句。",
        expectedSourceSha256: sha("相同句。中间。相同句。"),
        patches: [patch("相同句。", "明确句。")]
      })
    ).toThrow("出现 2 次");
  });

  it("applies multiple non-overlapping patches and preserves untouched text", () => {
    const source = "开头保留。旧句甲。中间原样保留。旧句乙。结尾保留。";
    const result = previewLoveLocalRevision({
      source,
      expectedSourceSha256: sha(source),
      patches: [
        patch("旧句甲。", "新句甲。", "第一条原因"),
        patch("旧句乙。", "新句乙。", "第二条原因")
      ]
    });
    expect(result.content).toBe(
      "开头保留。新句甲。中间原样保留。新句乙。结尾保留。"
    );
    expect(result.patches.map(({ reason }) => reason)).toEqual([
      "第一条原因",
      "第二条原因"
    ]);
    expect(result.sourceSha256).toBe(sha(source));
    expect(result.outputSha256).toBe(sha(result.content));
  });

  it("rejects overlapping patches and leaves source unchanged", () => {
    const source = "甲乙丙丁";
    expect(() =>
      previewLoveLocalRevision({
        source,
        expectedSourceSha256: sha(source),
        patches: [patch("甲乙丙", "甲乙"), patch("丙丁", "丙")]
      })
    ).toThrow("相互重叠");
    expect(source).toBe("甲乙丙丁");
  });

  it("rejects stale or missing target sentences", () => {
    const source = "现在的原文。";
    expect(() =>
      previewLoveLocalRevision({
        source,
        expectedSourceSha256: sha(source),
        patches: [patch("之前的原文。", "新句。")]
      })
    ).toThrow("没有应用任何修改");
  });

  it("rejects replacing the complete prose body, even when frontmatter exists", () => {
    const source =
      "---\nmodel: gpt-6.1-sol\nchapter: 2\n---\n旧正文第一句。旧正文第二句。";
    const body = "旧正文第一句。旧正文第二句。";
    expect(() =>
      previewLoveLocalRevision({
        source,
        expectedSourceSha256: sha(source),
        patches: [patch(body, "整篇重写。")]
      })
    ).toThrow("不能替换完整正文");
  });

  it("rejects multiple adjacent patches that together replace the complete body", () => {
    const source = "---\ntitle: 示例\n---\n第一句。第二句。";
    expect(() =>
      previewLoveLocalRevision({
        source,
        expectedSourceSha256: sha(source),
        patches: [
          patch("第一句。", "新第一句。"),
          patch("第二句。", "新第二句。")
        ]
      })
    ).toThrow("不能替换完整正文");
  });

  it("cannot locate metadata text and preserves frontmatter exactly in the preview", () => {
    const source =
      "---\nmodel: gpt-6.1-sol\nchapter: 2\n---\n正文提到了 gpt-6.1-sol。原文。";
    expect(() =>
      previewLoveLocalRevision({
        source,
        expectedSourceSha256: sha(source),
        patches: [patch("model: gpt-6.1-sol", "model: unknown")]
      })
    ).toThrow("不在正文中");

    const result = previewLoveLocalRevision({
      source,
      expectedSourceSha256: sha(source),
      patches: [patch("原文。", "新文。")]
    });
    expect(result.content).toBe(
      "---\nmodel: gpt-6.1-sol\nchapter: 2\n---\n正文提到了 gpt-6.1-sol。新文。"
    );
    expect(result.content.slice(0, source.indexOf("正文"))).toBe(
      source.slice(0, source.indexOf("正文"))
    );
  });

  it("supports a targeted sentence deletion while preserving surrounding prose", () => {
    const source = "保留开头。删除这一句。保留结尾。";
    const result = previewLoveLocalRevision({
      source,
      expectedSourceSha256: sha(source),
      patches: [patch("删除这一句。", "", "作者明确要求删掉此句")]
    });
    expect(result.content).toBe("保留开头。保留结尾。");
  });

  it.each(["\n", "\r\n"])(
    "protects BOM-prefixed metadata and retains raw offsets with %j line endings",
    (eol) => {
      const header = `\uFEFF---${eol}model: gpt-6.1-sol${eol}---${eol}`;
      const source = `${header}保留开头。原文。保留结尾。`;
      expect(() =>
        previewLoveLocalRevision({
          source,
          expectedSourceSha256: sha(source),
          patches: [patch("model: gpt-6.1-sol", "model: unknown")]
        })
      ).toThrow("不在正文中");
      const result = previewLoveLocalRevision({
        source,
        expectedSourceSha256: sha(source),
        patches: [patch("原文。", "新文。")]
      });
      expect(result.content).toBe(`${header}保留开头。新文。保留结尾。`);
      expect(result.patches[0]?.start).toBe(source.indexOf("原文。"));
      expect(result.sourceSha256).toBe(sha(source));
    }
  );

  it("still rejects replacing the entire body after BOM-prefixed metadata", () => {
    const source = "\uFEFF---\r\nmodel: gpt-6.1-sol\r\n---\r\n完整正文。";
    expect(() =>
      previewLoveLocalRevision({
        source,
        expectedSourceSha256: sha(source),
        patches: [patch("完整正文。", "全新正文。")]
      })
    ).toThrow("不能替换完整正文");
  });

  it("does not use the BOM as untouched prose to allow an entire-body replacement", () => {
    const source = "\uFEFF完整正文。";
    expect(() =>
      previewLoveLocalRevision({
        source,
        expectedSourceSha256: sha(source),
        patches: [patch("完整正文。", "全新正文。")]
      })
    ).toThrow("不能替换完整正文");
  });
});
