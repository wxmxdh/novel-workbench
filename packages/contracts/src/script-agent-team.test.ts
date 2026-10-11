import { describe, expect, it } from "vitest";
import {
  AgentTeamsListCommandEnvelopeSchema,
  AgentTeamsSaveCommandEnvelopeSchema,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  SCRIPT_WORKSPACE_AGENT_IDS,
  ScriptAgentTeamSettingsInputSchema,
  ScriptAgentTeamSettingsSchema,
  WorkspaceAgentTeamSettingsInputSchema,
  WorkspaceAgentTeamSettingsSchema,
  createEnvelope
} from "./index";

describe("script agent-team contracts", () => {
  it("provides one empty team for the unified script parent agent", () => {
    const settings = ScriptAgentTeamSettingsSchema.parse(
      DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
    );
    expect(settings.workspaceType).toBe("script");
    expect(settings.teams.map(({ parentAgentId }) => parentAgentId)).toEqual(
      SCRIPT_WORKSPACE_AGENT_IDS
    );
    expect(
      settings.teams.every(({ subagents }) => subagents.length === 0)
    ).toBe(true);
    expect(WorkspaceAgentTeamSettingsSchema.parse(settings).workspaceType).toBe(
      "script"
    );
    expect(
      ScriptAgentTeamSettingsInputSchema.parse(settings).workspaceType
    ).toBe("script");
    expect(
      WorkspaceAgentTeamSettingsInputSchema.parse(settings).workspaceType
    ).toBe("script");
  });

  it("accepts script agent-team list and save commands", () => {
    expect(
      AgentTeamsListCommandEnvelopeSchema.parse(
        createEnvelope("agentTeams.list", {}, { id: "script_team_list" })
      ).payload
    ).toEqual({});
    expect(
      AgentTeamsSaveCommandEnvelopeSchema.parse(
        createEnvelope(
          "agentTeams.save",
          {
            teamId: "team_default",
            settings: DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
          },
          { id: "script_team_save" }
        )
      ).payload.settings.workspaceType
    ).toBe("script");
  });

  it("rejects missing or duplicate script parent teams", () => {
    const duplicate = {
      ...DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
      teams: [
        ...DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS.teams,
        ...DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS.teams
      ]
    };
    expect(() => ScriptAgentTeamSettingsSchema.parse(duplicate)).toThrow();
    expect(() =>
      ScriptAgentTeamSettingsSchema.parse({
        workspaceType: "script",
        teams: []
      })
    ).toThrow();
  });
});
