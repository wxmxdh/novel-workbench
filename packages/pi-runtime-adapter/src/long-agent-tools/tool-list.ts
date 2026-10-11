import type { AgentTool } from "@earendil-works/pi-agent-core";
import { defineTool, textResult } from "./shared";
import { listScopeIdParameter, stageParameter, strictObject } from "./schemas";
import { LONG_STAGE_ROOTS, type LongStage } from "./entity-registry";
import type { LongToolContext } from "./context";
import { continuityScopeLines, draftScopeLines } from "./list-draft-continuity";
import { plotScopeLines } from "./list-plot";
import {
  characterScopeLines,
  worldbuildingScopeLines
} from "./list-world-character";

export function buildListTool(ctx: LongToolContext): AgentTool {
  const { readableRoots, loadIndex } = ctx;
  return defineTool({
    name: "list",
    label: "列出范围细节",
    description:
      "列出一个已知容器的二层结构，不分页也不搜索。必须同时提供 stage 与该 stage 允许的 scope_id；不能查询阶段最上层，也不能把叶子 id 再拿来 list。plot 允许 book_line、volume_、arc_、chapter_、event_、foreshadow_；draft 仅 volume_、arc_；continuity 仅 volume_、chapter_、character_，不要传 arc_。storyplot_、connection_、placement_、beat_ 等叶子用 read。返回稳定业务 id、标题与关系，不返回正文。",
    parameters: strictObject({
      stage: stageParameter,
      scope_id: listScopeIdParameter
    }),
    execute: async (_toolCallId, params, signal) => {
      const stage = params.stage as LongStage;
      const scopeId = params.scope_id;
      if (!scopeId) {
        throw new Error(
          "list 必须提供 scope_id；阶段最上层目录已在当前上下文中传输。"
        );
      }
      if (!readableRoots.has(LONG_STAGE_ROOTS[stage])) {
        throw new Error(`当前智能体无权读取 ${stage} 阶段。`);
      }
      const index = await loadIndex(signal);
      const lines =
        stage === "worldbuilding"
          ? worldbuildingScopeLines(index, scopeId)
          : stage === "character"
            ? characterScopeLines(index, scopeId)
            : stage === "plot"
              ? plotScopeLines(index, scopeId)
              : stage === "draft"
                ? draftScopeLines(index, scopeId)
                : continuityScopeLines(index, scopeId);
      return textResult(lines.join("\n"));
    }
  });
}
