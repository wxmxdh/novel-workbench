import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_SETTINGS,
  CommandEnvelopeSchema,
  LongAgentSettingsInputSchema,
  LongAgentSettingsSchema,
  createEnvelope,
  getDefaultLongAgentProfile
} from "./index";

function editableDefaults() {
  return {
    workspaceType: "long" as const,
    agents: DEFAULT_LONG_AGENT_SETTINGS.agents.map((agent) => ({
      id: agent.id,
      systemPrompt: agent.systemPrompt,
      welcomeShortcuts: [...agent.welcomeShortcuts] as [string, string, string],
      readAccess: {
        workspaceRoots: [...agent.readAccess.workspaceRoots],
        materialKinds: [...agent.readAccess.materialKinds],
        skillKinds: [...agent.readAccess.skillKinds]
      }
    }))
  };
}

describe("long agent settings contracts", () => {
  it("exposes a single long agent separate from short and script settings", () => {
    expect(
      LongAgentSettingsSchema.parse(DEFAULT_LONG_AGENT_SETTINGS).workspaceType
    ).toBe("long");
    expect(DEFAULT_LONG_AGENT_SETTINGS.agents).toHaveLength(1);
    expect(DEFAULT_LONG_AGENT_SETTINGS.agents[0]!.id).toBe("long");
  });

  it("allows prompts, shortcuts and catalog read types to be customized", () => {
    const input = editableDefaults();
    const agent = input.agents.find(({ id }) => id === "long")!;
    agent.systemPrompt = "先核对世界规则，再提出最小修改。";
    agent.welcomeShortcuts[0] = "检查当前世界规则";
    agent.readAccess.materialKinds = ["character", "plot"];
    agent.readAccess.skillKinds = ["general", "plot"];

    const parsed = LongAgentSettingsInputSchema.parse(input);
    expect(parsed.workspaceType).toBe("long");
    expect(parsed.agents.find(({ id }) => id === "long")).toMatchObject({
      id: "long",
      systemPrompt: "先核对世界规则，再提出最小修改。",
      readAccess: {
        materialKinds: ["character", "plot"],
        skillKinds: ["general", "plot"]
      }
    });
  });

  it("rejects input that narrows the fixed workspace read access", () => {
    const input = editableDefaults();
    input.agents.find(({ id }) => id === "long")!.readAccess.workspaceRoots = [
      "plot_design"
    ];

    expect(() => LongAgentSettingsInputSchema.parse(input)).toThrow(
      /builtin workspace read access/
    );
  });

  it("allows public catalog scopes but rejects workspace scope changes", () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_SETTINGS);
    const agent = settings.agents.find(({ id }) => id === "long")!;
    agent.readAccess.materialKinds = ["plot"];
    agent.readAccess.skillKinds = ["general", "plot"];

    expect(LongAgentSettingsSchema.parse(settings)).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: "long",
          readAccess: {
            workspaceRoots: expect.any(Array),
            materialKinds: ["plot"],
            skillKinds: ["general", "plot"]
          }
        })
      ])
    });

    agent.readAccess.workspaceRoots = ["plot_design"];

    expect(() => LongAgentSettingsSchema.parse(settings)).toThrow(
      /workspace read access is immutable/
    );
    expect(
      getDefaultLongAgentProfile("long").readAccess.workspaceRoots
    ).toEqual([
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "continuity_ledger"
    ]);
  });

  it("rejects public settings that try to narrow immutable write access", () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_SETTINGS);
    const agent = settings.agents.find(({ id }) => id === "long")!;
    agent.writeAccess.workspaceRoots = ["worldbuilding"];

    expect(() => LongAgentSettingsSchema.parse(settings)).toThrow(
      /write access is immutable/
    );
    expect(
      getDefaultLongAgentProfile("long").writeAccess.workspaceRoots
    ).toEqual([
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "continuity_ledger"
    ]);
  });

  it("requires exactly one long agent entry", () => {
    const empty = { ...editableDefaults(), agents: [] };
    expect(() => LongAgentSettingsInputSchema.parse(empty)).toThrow();

    const duplicated = editableDefaults();
    duplicated.agents.push(structuredClone(duplicated.agents[0]!));
    expect(() => LongAgentSettingsInputSchema.parse(duplicated)).toThrow();
  });

  it("validates independent long agent list, save and reset commands", () => {
    const input = editableDefaults();
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope("longAgents.list", {}, { id: "cmd_long_agents_list" })
      ).type
    ).toBe("longAgents.list");
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope("longAgents.save", input, {
          id: "cmd_long_agents_save"
        })
      ).type
    ).toBe("longAgents.save");
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "longAgents.reset",
          { agentId: "long" },
          { id: "cmd_long_agents_reset" }
        )
      ).type
    ).toBe("longAgents.reset");
  });
});
