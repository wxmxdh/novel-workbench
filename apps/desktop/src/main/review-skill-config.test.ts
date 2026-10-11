import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import { handleAgentTeamCommands } from "./ipc/agent-team-commands";
import {
  createEnvelope,
  DEFAULT_REVIEW_SKILL_IDS,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";

describe("global review method configuration", () => {
  it("persists via validated IPC, resolves inheritance and member opt-out without changing prompts or models", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-review-skills-"));
    try {
      const store = new AgentTeamConfigStore(root);
      const catalog = await store.list();
      const team = catalog.teams.find((item) => item.workspaceType === "long")!;
      const settings = structuredClone(team.settings);
      const member: ShortAgentSubagentDefinition = {
        id: "reviewer",
        name: "Reviewer",
        description: "Review",
        enabled: true,
        modelMode: "inherit",
        systemPrompt: "Author-owned prompt"
      };
      settings.teams[0]!.subagents = [
        member,
        { ...member, id: "off", name: "Off", reviewSkillIds: [] },
        { ...member, id: "custom", name: "Custom", reviewSkillIds: ["sepia"] }
      ];
      await store.save({ teamId: team.id, settings });
      await store.setEnabled({ teamId: team.id, enabled: true });
      expect((await store.resolve("long", "long"))[0]!.reviewSkillIds).toEqual(
        DEFAULT_REVIEW_SKILL_IDS
      );
      const result = await handleAgentTeamCommands(
        {
          requireAgentTeamConfigStore: () => store,
          dialog: {} as never,
          getDocumentsPath: () => root,
          getMainWindow: () => undefined
        },
        createEnvelope(
          "agentTeams.saveReviewSkills",
          { enabledIds: ["humanizer-zh"] as const },
          { id: "cmd_review_skills_test" }
        )
      );
      expect(result?.status).toBe("accepted");
      const reopened = new AgentTeamConfigStore(root);
      const resolved = await reopened.resolve("long", "long");
      expect(resolved.map((item) => item.reviewSkillIds)).toEqual([
        ["humanizer-zh"],
        [],
        ["sepia"]
      ]);
      expect(resolved[0]!.systemPrompt).toBe(member.systemPrompt);
      expect(resolved[0]!.modelMode).toBe("inherit");
      const stored = JSON.parse(
        await readFile(join(root, "config/agent-team-profiles.json"), "utf8")
      );
      expect(stored.reviewSkills).toEqual({ enabledIds: ["humanizer-zh"] });
      expect(
        stored.teams.find((item: { id: string }) => item.id === team.id)
          .settings.teams[0].subagents[0]
      ).not.toHaveProperty("reviewSkillIds");
      await reopened.saveReviewSkills({ enabledIds: [] });
      expect(
        (await reopened.resolve("long", "long"))[0]!.reviewSkillIds
      ).toEqual([]);
      await expect(
        reopened.saveReviewSkills({ enabledIds: ["unknown"] } as never)
      ).rejects.toThrow();
      await expect(
        reopened.saveReviewSkills({ enabledIds: ["sepia", "sepia"] })
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
