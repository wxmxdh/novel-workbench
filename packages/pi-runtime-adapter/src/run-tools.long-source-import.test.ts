import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { restrictLongSourceImportTools } from "./run-tools";

function namedTools(names: string[]): AgentTool[] {
  return names.map((name) => ({ name }) as AgentTool);
}

describe("long source import run tool restrictions", () => {
  it("limits an explicit import request to source proposal and read-only tools", () => {
    const tools = namedTools([
      "list",
      "read",
      "query_linked_material_entries",
      "load_skill",
      "ask_user_question",
      "query_imported_sources",
      "propose_long_source_import",
      "create",
      "edit",
      "delete",
      "commit_long_ledger",
      "spawn_subagent"
    ]);

    expect(
      restrictLongSourceImportTools(
        tools,
        "请把这个总稿导入新书，先给我建议"
      ).map((tool) => tool.name)
    ).toEqual([
      "list",
      "read",
      "query_linked_material_entries",
      "load_skill",
      "ask_user_question",
      "query_imported_sources",
      "propose_long_source_import"
    ]);
  });

  it("does not change tools for an ordinary discussion prompt", () => {
    const tools = namedTools(["read", "edit", "spawn_subagent"]);
    expect(restrictLongSourceImportTools(tools, "帮我分析下人物关系")).toBe(
      tools
    );
  });
});
