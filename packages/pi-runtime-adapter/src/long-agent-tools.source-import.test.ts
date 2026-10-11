import {
  describe,
  expect,
  it,
  longTools,
  resultText,
  toolByName
} from "./long-agent-tools.test-support";

describe("long source import proposal tool", () => {
  it("returns a structured suggestion without writing or confirming canon", async () => {
    const tool = toolByName(
      longTools({
        executor: async () => {
          throw new Error("query unused");
        }
      }),
      "propose_long_source_import"
    );
    const result = await tool.execute("proposal-1", {
      source_name: "接续总稿.md",
      title: "新小说基础资料",
      purpose: "foundation",
      authority: "candidate",
      summary: "作为新书讨论基础，保留原文。",
      conflicts: ["人物称呼需和新总稿核对"],
      unresolved_questions: ["旧素材是否沿用待作者决定"]
    });
    const output = JSON.parse(resultText(result)) as Record<string, unknown>;
    expect(output).toMatchObject({
      type: "long_source_import_proposal",
      book_id: "longbook_tools",
      source_name: "接续总稿.md",
      saved: false,
      author_confirmation_required: true,
      canon_status: "not_confirmed"
    });
  });

  it("keeps a large candidate body out of the tool result receipt", async () => {
    const tool = toolByName(
      longTools({
        executor: async () => {
          throw new Error("query unused");
        }
      }),
      "propose_long_source_import"
    );
    const candidate = "章节候选内容".repeat(2_000);
    const result = await tool.execute("proposal-large", {
      source_name: "本次讨论",
      title: "大纲候选",
      purpose: "outline",
      authority: "candidate",
      summary: "已整理成长篇章节候选。",
      conflicts: [],
      unresolved_questions: [],
      candidate_content: candidate
    });
    const resultTextValue = resultText(result);
    const output = JSON.parse(resultTextValue) as Record<string, unknown>;
    expect(resultTextValue.length).toBeLessThan(4_000);
    expect(resultTextValue).not.toContain(candidate);
    expect(output).toMatchObject({
      type: "long_source_import_proposal",
      source_name: "本次讨论",
      saved: false,
      canon_status: "not_confirmed"
    });
  });

  it("requires candidate outline text for a discussion source", async () => {
    const tool = toolByName(
      longTools({
        executor: async () => {
          throw new Error("query unused");
        }
      }),
      "propose_long_source_import"
    );
    const result = await tool.execute("proposal-2", {
      source_name: "本次讨论",
      title: "候选大纲",
      purpose: "outline",
      authority: "candidate",
      summary: "讨论整理",
      conflicts: [],
      unresolved_questions: []
    });
    expect(resultText(result)).toContain("尚未保存任何内容");
  });

  it("does not let an attachment proposal replace its original text", async () => {
    const tool = toolByName(
      longTools({
        executor: async () => {
          throw new Error("query unused");
        }
      }),
      "propose_long_source_import"
    );
    const result = await tool.execute("proposal-3", {
      source_name: "接续总稿.md",
      title: "新小说基础资料",
      purpose: "foundation",
      authority: "candidate",
      summary: "整理摘要",
      conflicts: [],
      unresolved_questions: [],
      candidate_content: "模型改写内容"
    });
    expect(resultText(result)).toContain("不能替换附件原文");
  });
});
