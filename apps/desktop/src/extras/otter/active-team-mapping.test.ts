import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  AgentTeamCatalogSnapshotSchema,
  defaultBuiltinSubagentSettings,
  type AgentTeamCatalogSnapshot
} from "@deepwrite/contracts";
import { mapActiveLongTeamMembers } from "./active-team-mapping";

function snapshot(): AgentTeamCatalogSnapshot {
  const settings = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
  settings.teams[0]!.subagents.push(
    {
      id: "people-review",
      name: "人物复核",
      description: "检查人物事实",
      systemPrompt: "遵守人物资料边界。",
      enabled: true,
      modelMode: "custom",
      modelId: "model-a",
      thinkingLevel: "high",
      temperature: 0.7
    },
    {
      id: "inherited-review",
      name: "继承助手",
      description: "沿用主对话参数",
      systemPrompt: "沿用主对话设置。",
      enabled: true,
      modelMode: "inherit",
      modelId: "stale-model",
      thinkingLevel: "high",
      temperature: 0.9
    },
    {
      id: "disabled",
      name: "停用助手",
      description: "不进入计划",
      systemPrompt: "停用内容",
      enabled: false,
      modelMode: "inherit"
    }
  );
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: { long: "active" },
    builtinSubagents: defaultBuiltinSubagentSettings(),
    teams: [
      {
        id: "active",
        name: "启用团队",
        workspaceType: "long",
        settings
      }
    ]
  });
}

describe("mapActiveLongTeamMembers", () => {
  it("runs explicitly selected saved teams without changing the global enabled slot or merging repeated role IDs", () => {
    const value = snapshot();
    const second = structuredClone(value.teams[0]!);
    second.id = "other";
    second.name = "另一团队";
    value.teams.push(second);
    value.enabledTeamIds = {};
    const members = mapActiveLongTeamMembers(
      value,
      "long",
      ["active", "other"],
      ["active/people-review", "other/people-review"]
    );
    expect(members).toHaveLength(2);
    expect(new Set(members.map((member) => member.memberId)).size).toBe(2);
    expect(value.enabledTeamIds).toEqual({});
    expect(members.map((member) => member.teamName)).toEqual([
      "启用团队",
      "另一团队"
    ]);
  });
  it("rejects stale, repeated, or disabled role keys", () => {
    expect(() =>
      mapActiveLongTeamMembers(
        snapshot(),
        "long",
        ["active"],
        ["active/disabled"]
      )
    ).toThrow(/职责已变化/);
    expect(() =>
      mapActiveLongTeamMembers(snapshot(), "long", ["active", "active"])
    ).toThrow(/重复选择/);
    expect(() =>
      mapActiveLongTeamMembers(snapshot(), "long", ["missing"])
    ).toThrow(/已变化/);
  });
  it("uses only enabled definitions from the active long profile", () => {
    expect(mapActiveLongTeamMembers(snapshot(), "long")).toEqual([
      {
        teamName: "启用团队",
        memberName: "人物复核",
        memberId: "people-review",
        role: "遵守人物资料边界。",
        modelId: "model-a",
        thinkingLevel: "high",
        temperature: 0.7
      },
      {
        teamName: "启用团队",
        memberName: "继承助手",
        memberId: "inherited-review",
        role: "沿用主对话设置。"
      }
    ]);
  });

  it("requires an active original long profile", () => {
    const value = snapshot();
    value.enabledTeamIds = {};
    expect(() => mapActiveLongTeamMembers(value, "long")).toThrow(
      /启用长篇团队/
    );
  });
});
