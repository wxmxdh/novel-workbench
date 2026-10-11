import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  LongAgentTeamSettingsInputSchema,
  type ModelConfig
} from "@deepwrite/contracts";
import {
  buildLongTeamPresetSettings,
  buildCombinedLongTeamPresetSettings,
  buildTeamRecommendations,
  uniqueTeamName
} from "./teamRecommendations";

function model(
  id: string,
  label: string,
  modelId: string,
  overrides: Partial<ModelConfig> = {}
): ModelConfig {
  return {
    id,
    label,
    provider: "custom",
    modelId,
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: true,
    ...overrides
  };
}

describe("team role recommendations", () => {
  it("matches role suggestions only to enabled models with configured keys", () => {
    const recommendations = buildTeamRecommendations([
      model("gemini", "Antigravity Gemini 3.8 Flash", "gemini-3.8-flash-high"),
      model("deepseek", "OpenCode DeepSeek V4.1 Flash", "deepseek-v4.1-flash"),
      model("claude", "Claude Opus 5", "claude-opus-4-6-thinking"),
      model("gpt", "GPT 6.1 Sol", "gpt-6.1-sol"),
      model("disabled", "Gemini 3.8 Flash disabled", "gemini-3.8-flash", {
        enabled: false
      }),
      model("no-key", "DeepSeek no key", "deepseek-v4.1-flash", {
        hasApiKey: false
      })
    ]);

    expect(recommendations.map(({ modelLabel }) => modelLabel)).toEqual([
      "Antigravity Gemini 3.8 Flash",
      "OpenCode DeepSeek V4.1 Flash",
      "Claude Opus 5",
      "Claude Opus 5",
      "GPT 6.1 Sol"
    ]);
  });

  it("keeps project-specific assumptions empty and defers to current project rules", () => {
    const recommendations = buildTeamRecommendations([]);
    expect(recommendations).toHaveLength(5);
    for (const recommendation of recommendations) {
      expect(recommendation.systemPrompt).toContain(
        "当前作品实际提供的项目说明"
      );
      expect(recommendation.systemPrompt).toContain("优先于本角色的一般方法");
      expect(recommendation.systemPrompt).toContain("不代作者写正文");
      expect(recommendation.modelId).toBeNull();
    }
    expect(recommendations[2]?.systemPrompt).not.toContain("What Is Love");
  });

  it("builds a long-form team without enabling or changing any existing team", () => {
    const recommendation = buildTeamRecommendations([
      model("deepseek", "OpenCode DeepSeek V4.1 Flash", "deepseek-v4.1-flash")
    ])[1]!;
    const settings = buildLongTeamPresetSettings(
      recommendation,
      "作者希望先看人物因果。"
    );

    expect(settings.workspaceType).toBe("long");
    expect(settings.teams).toHaveLength(
      DEFAULT_LONG_AGENT_TEAM_SETTINGS.teams.length
    );
    expect(LongAgentTeamSettingsInputSchema.parse(settings)).toEqual(settings);
    expect(
      settings.teams.find((team) => team.parentAgentId === "long")?.subagents[0]
    ).toMatchObject({
      id: "preset-continuity",
      name: "逻辑与连续性核对员",
      enabled: true,
      modelMode: "custom",
      modelId: "deepseek"
    });
    expect(
      settings.teams.find((team) => team.parentAgentId === "long")?.subagents[0]
        ?.systemPrompt
    ).toContain("作者希望先看人物因果");
    expect(
      settings.teams.find((team) => team.parentAgentId === "long")?.subagents[0]
        ?.systemPrompt
    ).toContain("在其它作品中使用时也会带上");
    expect(
      settings.teams.find((team) => team.parentAgentId === "long")?.subagents[0]
        ?.systemPrompt
    ).toContain("本作品project-profile和rules优先");

    const inherited = buildLongTeamPresetSettings(
      buildTeamRecommendations([])[0]!,
      ""
    );
    expect(
      inherited.teams.find((team) => team.parentAgentId === "long")
        ?.subagents[0]
    ).toMatchObject({
      modelMode: "inherit"
    });
    expect(
      inherited.teams.find((team) => team.parentAgentId === "long")
        ?.subagents[0]?.modelId
    ).toBeUndefined();
  });

  it("chooses a new profile name without renaming existing profiles", () => {
    const existing = ["情节发散", "情节发散 2"];
    expect(uniqueTeamName("情节发散", existing)).toBe("情节发散 3");
    expect(existing).toEqual(["情节发散", "情节发散 2"]);
  });

  it("builds one valid combined long team with five distinct specialist roles", () => {
    const recommendations = buildTeamRecommendations([
      model("gemini", "Antigravity Gemini 3.8 Flash", "gemini-3.8-flash-high"),
      model("deepseek", "OpenCode DeepSeek V4.1 Flash", "deepseek-v4.1-flash"),
      model("claude", "Claude Opus 5", "claude-opus-4-6-thinking"),
      model("gpt", "GPT 6.1 Sol", "gpt-6.1-sol")
    ]);
    const settings = buildCombinedLongTeamPresetSettings(recommendations, "");
    const longTeam = settings.teams.find(
      (team) => team.parentAgentId === "long"
    );

    expect(LongAgentTeamSettingsInputSchema.parse(settings)).toEqual(settings);
    expect(longTeam?.subagents).toHaveLength(5);
    expect(new Set(longTeam?.subagents.map(({ id }) => id)).size).toBe(5);
    expect(longTeam?.subagents.map(({ id }) => id)).toEqual([
      "preset-divergent",
      "preset-continuity",
      "preset-realism",
      "preset-viewpoint",
      "preset-scoring"
    ]);
    expect(
      longTeam?.subagents.map(({ modelMode, modelId }) => ({
        modelMode,
        modelId
      }))
    ).toEqual([
      { modelMode: "custom", modelId: "gemini" },
      { modelMode: "custom", modelId: "deepseek" },
      { modelMode: "custom", modelId: "claude" },
      { modelMode: "custom", modelId: "claude" },
      { modelMode: "custom", modelId: "gpt" }
    ]);
    expect(() =>
      buildCombinedLongTeamPresetSettings(
        [recommendations[0]!, recommendations[0]!],
        ""
      )
    ).toThrow("综合团队中不能重复添加同一职责");
  });
});
