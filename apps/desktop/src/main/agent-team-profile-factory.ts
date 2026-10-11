import { randomUUID } from "node:crypto";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  type AgentTeamProfile,
  type AgentTeamProfileSaveInput,
  type AgentTeamWorkspaceType
} from "@deepwrite/contracts";

function createTeamId(): string {
  return `team_${randomUUID().replaceAll("-", "")}`;
}

export function defaultAgentTeamName(
  workspaceType: AgentTeamWorkspaceType
): string {
  return workspaceType === "short"
    ? "默认短篇团队"
    : workspaceType === "script"
      ? "默认剧本团队"
      : "默认长篇团队";
}

export function createAgentTeamProfile(
  workspaceType: AgentTeamWorkspaceType,
  name = defaultAgentTeamName(workspaceType),
  settings?: AgentTeamProfileSaveInput["settings"]
): AgentTeamProfile {
  const base = { id: createTeamId(), name };
  if (workspaceType === "short") {
    return {
      ...base,
      workspaceType,
      settings: structuredClone(
        settings?.workspaceType === "short"
          ? settings
          : DEFAULT_AGENT_TEAM_SETTINGS
      )
    };
  }
  if (workspaceType === "script") {
    return {
      ...base,
      workspaceType,
      settings: structuredClone(
        settings?.workspaceType === "script"
          ? settings
          : DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
      )
    };
  }
  return {
    ...base,
    workspaceType,
    settings: structuredClone(
      settings?.workspaceType === "long"
        ? settings
        : DEFAULT_LONG_AGENT_TEAM_SETTINGS
    )
  };
}
