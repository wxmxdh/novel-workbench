import { describe, expect, it } from "vitest";
import { extractMarkdownHeadings } from "./markdownOutline";

describe("extractMarkdownHeadings", () => {
  it("extracts every ATX heading level in document order", () => {
    const headings = extractMarkdownHeadings(
      [
        "# 一级",
        "## 二级",
        "### 三级",
        "#### 四级",
        "##### 五级",
        "###### 六级"
      ].join("\n")
    );

    expect(
      headings.map(({ index, level, label }) => ({ index, level, label }))
    ).toEqual([
      { index: 0, level: 1, label: "一级" },
      { index: 1, level: 2, label: "二级" },
      { index: 2, level: 3, label: "三级" },
      { index: 3, level: 4, label: "四级" },
      { index: 4, level: 5, label: "五级" },
      { index: 5, level: 6, label: "六级" }
    ]);
  });

  it("turns inline Markdown into readable labels and keeps duplicates distinct", () => {
    const headings = extractMarkdownHeadings(
      "## **重复**与[链接](https://example.test)及`代码`\n## **重复**与[链接](https://example.test)及`代码`"
    );

    expect(headings).toMatchObject([
      { index: 0, level: 2, label: "重复与链接及代码" },
      { index: 1, level: 2, label: "重复与链接及代码" }
    ]);
  });

  it("ignores fenced code and unsupported heading syntax", () => {
    const headings = extractMarkdownHeadings(
      [
        "```md",
        "# 代码中的标题",
        "```",
        "普通文字",
        "---",
        "####### 七级",
        "### 正文标题"
      ].join("\n")
    );

    expect(headings).toMatchObject([{ index: 0, level: 3, label: "正文标题" }]);
  });

  it("provides a readable fallback for an empty rendered heading", () => {
    expect(extractMarkdownHeadings("#  ")).toMatchObject([
      { index: 0, level: 1, label: "未命名标题" }
    ]);
  });
});
