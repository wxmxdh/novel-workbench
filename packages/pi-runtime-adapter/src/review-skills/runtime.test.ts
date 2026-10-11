import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildReviewSkillRuntime,
  isReviewSkillRun,
  reviewSkillBundle
} from "./runtime";
import type { RuntimeSubagentDefinition } from "../subagent-types";
const definition: RuntimeSubagentDefinition = {
  id: "reviewer",
  name: "审阅员",
  description: "审阅",
  systemPrompt: "审阅当前稿件",
  enabled: true,
  modelMode: "inherit"
};
const input = {
  definition,
  task: "请审核这一章，不修改正文",
  executorModel: "fixture-model"
};
describe("bundled review skill runtime", () => {
  it("defaults to Shuorenhua and retains explicitly selected archived methods", async () => {
    const all = buildReviewSkillRuntime(input);
    const active = reviewSkillBundle.shuorenhua;
    expect(all.requirements).toContain(active.files["SKILL.md"]);
    expect(all.requirements).toContain("shuorenhua");
    expect(all.requirements).not.toContain(
      reviewSkillBundle["human-writing"].files["SKILL.md"]!
    );
    expect(createHash("sha256").update(active.files["SKILL.md"]!).digest("hex"))
      .toBe(active.hashes["SKILL.md"]);
    const referenceTool = all.tool!;
    expect(referenceTool.name).toBe("load_review_skill");
    expect(referenceTool.parameters).toBeDefined();
    expect(all.requirements).toContain("references/editing-guide.md");
    expect(all.requirements).toContain("references/examples.md");
    const editingGuide = await referenceTool.execute("test", {
      skill_id: "shuorenhua",
      path: "references/editing-guide.md"
    });
    expect(editingGuide.content.find((block) => block.type === "text")?.text).toContain(
      reviewSkillBundle.shuorenhua.files["references/editing-guide.md"]!
    );
    const single = buildReviewSkillRuntime({
      ...input,
      definition: { ...definition, reviewSkillIds: ["sepia"] }
    });
    expect(single.requirements).toContain(
      reviewSkillBundle.sepia.files["SKILL.md"]
    );
    expect(single.requirements).not.toContain(
      reviewSkillBundle["human-writing"].files["SKILL.md"]
    );
    expect(
      buildReviewSkillRuntime({
        ...input,
        definition: { ...definition, reviewSkillIds: [] }
      })
    ).toEqual({ requirements: "" });
  });
  it.each(["写一章并自查", "规划第一章", "Please write a draft and review it"])(
    "does not enable methods for creation: %s",
    (task) => {
      expect(buildReviewSkillRuntime({ ...input, task })).toEqual({
        requirements: ""
      });
    }
  );
  it("permits ordinary review and frozen LOVE review, excluding writers and managers", () => {
    expect(isReviewSkillRun(input)).toBe(true);
    expect(isReviewSkillRun({ ...input, task: "Review this draft" })).toBe(
      true
    );
    expect(isReviewSkillRun({ ...input, task: "请审阅这一版修订稿" })).toBe(
      true
    );
    expect(
      isReviewSkillRun({ ...input, frozenReview: true, task: "核对场次" })
    ).toBe(true);
    for (const special of [
      { ...definition, id: "love-writer-fixture" },
      { ...definition, toolSource: "library-management" as const }
    ])
      expect(
        isReviewSkillRun({ ...input, definition: special, frozenReview: true })
      ).toBe(false);
  });
  it("reads exact reference snapshots and refuses traversal, disabled skills and personas", async () => {
    const tool = buildReviewSkillRuntime({
      ...input,
      definition: { ...definition, reviewSkillIds: ["sepia"] }
    }).tool!;
    const result = await tool.execute("test", {
      skill_id: "sepia",
      path: "references/languages/zh.md"
    });
    expect(result.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining(
          reviewSkillBundle.sepia.files["references/languages/zh.md"]!
        )
      })
    ]);
    await expect(
      tool.execute("test", { skill_id: "human-writing" })
    ).rejects.toThrow("未启用");
    await expect(
      tool.execute("test", { skill_id: "sepia", path: "../SKILL.md" })
    ).rejects.toThrow("快照");
    await expect(
      tool.execute("test", { skill_id: "sepia", path: "__proto__" })
    ).rejects.toThrow("快照");
    await expect(
      tool.execute("test", {
        skill_id: "sepia",
        path: "references/voices/hemingway.md"
      })
    ).rejects.toThrow("voice/persona");
    await expect(
      tool.execute("test", {
        skill_id: "sepia",
        path: "references/voices/registry.md"
      })
    ).resolves.toBeDefined();
  });
  it("puts the review adaptation after external instructions and retains author scope", () => {
    const { requirements } = buildReviewSkillRuntime(input);
    expect(requirements.lastIndexOf("工作台审核适配")).toBeGreaterThan(
      requirements.indexOf("# 说人话")
    );
    expect(requirements).toContain("允许零意见");
    expect(requirements).toContain("不报告 AI 概率");
    expect(requirements).toContain("fixture-model");
  });
});
