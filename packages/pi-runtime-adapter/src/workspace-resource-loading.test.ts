import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  MATERIAL_KINDS,
  SKILL_KINDS,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { buildRuntimeUserPrompt } from "./prompts";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools
} from "./short-agent-tools";
import {
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

const attachedMaterials: WorkspaceRuntimeContext["attachedMaterials"] =
  MATERIAL_KINDS.map((kind) => ({
    id: `material-${kind}`,
    title: `参考-${kind}`,
    kind,
    source: "attached-material",
    content: `素材原文-${kind}`
  }));
const attachedSkills: WorkspaceRuntimeContext["attachedSkills"] =
  SKILL_KINDS.map((kind) => ({
    id: `skill-${kind}`,
    title: `方法-${kind}`,
    kind,
    source: "attached-skill",
    content: `技能原文-${kind}`
  }));

describe.each(["short", "script"] as const)(
  "%s resources across stages",
  (workspaceType) => {
    it.each(["character_design", "plot_design", "draft", "custom-stage"])(
      "lists every kind in the prompt and loads original content in %s",
      async (stageId) => {
        const workspace = shortWorkspace(stageId);
        const attachments = { attachedMaterials, attachedSkills };
        const tools =
          workspaceType === "short"
            ? buildShortWorkspaceTools({
                workspace,
                profile: shortProfile(),
                ...attachments
              })
            : buildScriptWorkspaceTools({
                workspace: { ...workspace, activeAgentId: "script" },
                profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!,
                ...attachments
              });
        const prompt = buildRuntimeUserPrompt({
          sessionId: "session-resource-test",
          runId: "run-resource-test",
          prompt: "参考资料",
          ...(workspaceType === "short"
            ? {
                agentProfile: shortProfile(),
                workspaceContext: { shortWorkspace: workspace, ...attachments }
              }
            : {
                scriptAgentProfile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!,
                workspaceContext: {
                  scriptWorkspace: {
                    ...workspace,
                    activeAgentId: "script" as const
                  },
                  ...attachments
                }
              })
        });
        const query = toolByName(tools, "query_linked_material_entries");
        const listed = resultText(
          await query.execute("list", { mode: "list" })
        );
        for (const kind of MATERIAL_KINDS) {
          expect(prompt).toContain(`参考-${kind}`);
          expect(listed).toContain(`material-${kind}`);
          expect(
            resultText(
              await query.execute("read", {
                mode: "read",
                entry_id: `material-${kind}`
              })
            )
          ).toContain(`素材原文-${kind}`);
        }
        for (const kind of SKILL_KINDS) {
          expect(prompt).toContain(`方法-${kind}`);
          expect(
            resultText(
              await toolByName(tools, "load_skill").execute("load", {
                name: `方法-${kind}`
              })
            )
          ).toContain(`技能原文-${kind}`);
        }
      }
    );

    it("passes the full profile scope to live Core queries in character design", async () => {
      const queryMaterials = vi.fn().mockResolvedValue({
        status: "ok",
        entries: [],
        total: 0,
        notices: []
      });
      const workspace = shortWorkspace("character_design");
      const tools =
        workspaceType === "short"
          ? buildShortWorkspaceTools({
              workspace,
              profile: shortProfile(),
              queryMaterials
            })
          : buildScriptWorkspaceTools({
              workspace: { ...workspace, activeAgentId: "script" },
              profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!,
              queryMaterials
            });
      await toolByName(tools, "query_linked_material_entries").execute(
        "query",
        { mode: "list" }
      );
      expect(queryMaterials.mock.calls[0]?.[1]).toEqual(MATERIAL_KINDS);
    });
  }
);
