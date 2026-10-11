import { describe, expect, it } from "vitest";
import { catalogBodyTextKind, longBodyTextKind } from "./bodyTextTarget";
import { formatBodyText } from "./bodyTextFormat";
import { renderMarkdown } from "./renderMarkdown";
import type { BodyTextFormat } from "@deepwrite/contracts";
import type { WorkspaceDocument } from "../types/workspace";

const formats: BodyTextFormat[] = [
  "flush-compact",
  "flush-spaced",
  "indent-compact",
  "indent-spaced"
];

describe("body text formatting", () => {
  it.each([
    ["flush-compact", "甲  乙。\n丙。\n丁。"],
    ["flush-spaced", "甲  乙。\n\n丙。\n\n丁。"],
    ["indent-compact", "　　甲  乙。\n　　丙。\n　　丁。"],
    ["indent-spaced", "　　甲  乙。\n\n　　丙。\n\n　　丁。"]
  ] as const)("normalizes explicit paragraphs with %s", (format, expected) => {
    const source = "\r\n　甲  乙。\r\n \t\r\n\r\n\t 丙。\r    丁。\n　\n";
    expect(formatBodyText(source, format)).toBe(expected);
    expect(formatBodyText(expected, format)).toBe(expected);
  });
  it.each(formats)(
    "keeps empty text empty and never wraps long lines (%s)",
    (format) => {
      expect(formatBodyText("", format)).toBe("");
      expect(formatBodyText(" \t\r\n　", format)).toBe("");
      expect(
        formatBodyText("字".repeat(20000), format).split("\n")
      ).toHaveLength(1);
    }
  );
  const blocks = [
    "# 标题",
    "标题\n====",
    "---",
    "- 条目\n  - 嵌套条目\n\n    缩进延续\n- 第二项",
    "1. 条目\n   延续\n2. 第二项",
    "> 引用\n>\n>   缩进引用",
    "```text\n  code\n\n\tkeep\n```",
    "~~~~text\n  code\n```\n~~~~",
    "| 标题 | 值 |\n| :--- | ---: |\n| A | B |"
  ];
  it.each(formats)(
    "preserves Markdown blocks and stays idempotent (%s)",
    (format) => {
      for (const block of blocks) {
        const source = "  前文。\n后文。\n\n" + block + "\n\n  结尾。";
        const result = formatBodyText(source, format);
        expect(result).toContain("\n\n" + block + "\n\n");
        expect(formatBodyText(result, format)).toBe(result);
      }
    }
  );
  it("preserves an unclosed code fence including its trailing whitespace", () => {
    const source = "```text\n  source\n\n";
    expect(formatBodyText(source, "indent-spaced")).toBe(source);
  });
  it("keeps full-width indentation and paragraph spacing visible in Markdown", () => {
    expect(renderMarkdown(formatBodyText("甲\n乙", "indent-spaced"))).toBe(
      "<p>　　甲</p><p>　　乙</p>"
    );
    expect(renderMarkdown(formatBodyText("甲\n乙", "indent-compact"))).toBe(
      "<p>　　甲<br>　　乙</p>"
    );
  });
  it("only enables manuscript bodies in the matching workspace", () => {
    const document: WorkspaceDocument = {
      id: "body",
      domain: "creation",
      title: "正文",
      eyebrow: "",
      path: [],
      content: "",
      workspaceType: "short",
      draftFileKind: "body"
    };
    expect(catalogBodyTextKind(document)).toBe("short");
    expect(catalogBodyTextKind({ ...document, workspaceType: "script" })).toBe(
      "script"
    );
    expect(
      catalogBodyTextKind({ ...document, draftFileKind: "character-state" })
    ).toBeUndefined();
    const { draftFileKind: _, ...nonBodyDocument } = document;
    expect(catalogBodyTextKind(nonBodyDocument)).toBeUndefined();
    expect(
      catalogBodyTextKind({ ...document, domain: "material" })
    ).toBeUndefined();
    expect(
      catalogBodyTextKind({ ...document, domain: "skill" })
    ).toBeUndefined();
    expect(longBodyTextKind("draft", "body")).toBe("long");
    expect(longBodyTextKind("draft", "character-state")).toBeUndefined();
    expect(longBodyTextKind("continuity_ledger", "body")).toBeUndefined();
    expect(longBodyTextKind("plot_design", "content")).toBeUndefined();
  });
});
