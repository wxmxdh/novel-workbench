import { describe, expect, it } from "vitest";
import {
  parseMaterialMarkdown,
  parseSkillMarkdown
} from "@deepwrite/contracts/renderer";
import { analysisResultEntry } from "./analysis-result-content";

describe.each(["material", "skill"] as const)(
  "%s analysis result",
  (domain) => {
    const draft = {
      name: "悬念设计",
      description: "用于安排信息揭示与结尾钩子。",
      content: "# 方法\n\n先提出疑问，再逐步兑现。"
    };

    it("adds readable metadata and preserves the edited body", () => {
      const entry = analysisResultEntry(draft, domain);
      expect(entry.title).toBe(draft.name);
      const parsed =
        domain === "skill"
          ? parseSkillMarkdown(entry.content)
          : parseMaterialMarkdown(entry.content);
      expect(parsed).toMatchObject({
        name: draft.name,
        description: draft.description
      });
      if (!("body" in parsed)) throw new Error("Invalid generated metadata");
      expect(parsed.body.trim()).toBe(draft.content);
      expect(entry.content.endsWith(draft.content)).toBe(true);
      expect(draft.content.startsWith("---")).toBe(false);
    });

    it("updates an existing header without duplicating it or losing other fields", () => {
      const entry = analysisResultEntry(
        {
          ...draft,
          content: `---\nname: 旧名称\ndescription: 旧说明\ntags: suspense\n---\n\n${draft.content}`
        },
        domain
      );
      expect(entry.content.match(/^---$/gm)).toHaveLength(2);
      expect(entry.content).toContain("tags: suspense");
      expect(entry.content).not.toContain("旧名称");
      expect(entry.content).not.toContain("旧说明");
      expect(entry.content.endsWith(draft.content)).toBe(true);
      expect(
        analysisResultEntry({ ...draft, content: entry.content }, domain)
      ).toEqual(entry);
    });

    it.each(["name", "description", "content"] as const)(
      "rejects an empty edited %s",
      (field) => {
        expect(() =>
          analysisResultEntry({ ...draft, [field]: "  " }, domain)
        ).toThrow("请填写");
      }
    );

    it("rejects malformed existing metadata", () => {
      expect(() =>
        analysisResultEntry(
          { ...draft, content: "---\nname: 未关闭\n正文" },
          domain
        )
      ).toThrow();
    });
  }
);
