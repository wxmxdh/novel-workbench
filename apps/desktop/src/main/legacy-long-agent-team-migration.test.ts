import { describe, expect, it } from "vitest";
import { migrateLegacyLongAgentTeamSettings } from "./legacy-long-agent-team-migration";

function definition(id: string, name = id) {
  return {
    id,
    name,
    description: `${name}能力`,
    systemPrompt: `${name}提示词`,
    enabled: true,
    modelMode: "inherit" as const
  };
}

describe("migrateLegacyLongAgentTeamSettings", () => {
  it("merges the four historical long parents into the unified long parent", () => {
    const migrated = migrateLegacyLongAgentTeamSettings({
      workspaceType: "long",
      teams: [
        { parentAgentId: "setting", subagents: [definition("setting_helper")] },
        {
          parentAgentId: "plot_design",
          subagents: [definition("plot_helper")]
        },
        { parentAgentId: "draft", subagents: [definition("draft_helper")] },
        {
          parentAgentId: "continuity_ledger",
          subagents: [definition("ledger_helper")]
        }
      ]
    });

    expect(migrated).toHaveLength(1);
    expect(migrated?.[0]?.teams).toEqual([
      {
        parentAgentId: "long",
        subagents: expect.arrayContaining([
          expect.objectContaining({ id: "setting_helper" }),
          expect.objectContaining({ id: "plot_helper" }),
          expect.objectContaining({ id: "draft_helper" }),
          expect.objectContaining({ id: "ledger_helper" })
        ])
      }
    ]);
  });

  it("accepts older parent ids and resolves duplicate ids and names", () => {
    const migrated = migrateLegacyLongAgentTeamSettings({
      workspaceType: "long",
      teams: [
        {
          parentAgentId: "worldbuilding",
          subagents: [definition("helper", "助手")]
        },
        {
          parentAgentId: "character_design",
          subagents: [definition("helper", "助手")]
        },
        {
          parentAgentId: "expert_section_writer",
          subagents: [definition("writer", "写手")]
        }
      ]
    });
    const subagents = migrated?.[0]?.teams[0]?.subagents ?? [];

    expect(subagents).toHaveLength(3);
    expect(
      new Set(subagents.map(({ id }) => id.toLocaleLowerCase())).size
    ).toBe(3);
    expect(
      new Set(subagents.map(({ name }) => name.toLocaleLowerCase())).size
    ).toBe(3);
    expect(subagents[1]).toMatchObject({
      id: "helper_character_design",
      name: "助手（人物）"
    });
  });

  it("splits overflow into additional current long-team settings without dropping data", () => {
    const migrated = migrateLegacyLongAgentTeamSettings({
      workspaceType: "long",
      teams: [
        {
          parentAgentId: "draft",
          subagents: Array.from({ length: 61 }, (_, index) =>
            definition(`helper_${index + 1}`)
          )
        }
      ]
    });

    expect(migrated?.map(({ teams }) => teams[0]!.subagents.length)).toEqual([
      60, 1
    ]);
    expect(
      migrated?.flatMap(({ teams }) => teams[0]!.subagents).map(({ id }) => id)
    ).toHaveLength(61);
  });
});
