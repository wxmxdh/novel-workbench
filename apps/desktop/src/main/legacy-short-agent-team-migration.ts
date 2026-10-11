import {
  AgentTeamSettingsInputSchema,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  type AgentTeamSettings
} from "@deepwrite/contracts";
import {
  chunkLegacyAgentTeamDefinitions,
  collectLegacyAgentTeamDefinitions
} from "./legacy-agent-team-migration";

const LEGACY_SHORT_PARENT_LABELS = {
  character_design: "人物",
  plot_design: "剧情",
  outline: "大纲",
  expert_draft_coordinator: "正文",
  expert_section_writer: "单节写手",
  short: "短篇"
} as const;

const LEGACY_SHORT_PARENT_SETS = [
  [
    "character_design",
    "plot_design",
    "outline",
    "expert_draft_coordinator",
    "expert_section_writer"
  ],
  [
    "character_design",
    "plot_design",
    "expert_draft_coordinator",
    "expert_section_writer"
  ],
  ["character_design", "plot_design", "expert_draft_coordinator"]
] as const;

export function migrateLegacyShortAgentTeamSettings(
  raw: Record<string, unknown>
): AgentTeamSettings[] | undefined {
  const current = AgentTeamSettingsInputSchema.safeParse(raw);
  if (current.success) return [current.data];
  const definitions = collectLegacyAgentTeamDefinitions(raw, {
    workspaceType: "short",
    parentLabels: LEGACY_SHORT_PARENT_LABELS,
    parentSets: LEGACY_SHORT_PARENT_SETS
  });
  if (!definitions) return undefined;
  return chunkLegacyAgentTeamDefinitions(
    definitions,
    SHORT_AGENT_SUBAGENT_MAX_COUNT
  ).map((subagents) =>
    AgentTeamSettingsInputSchema.parse({
      workspaceType: "short",
      teams: [{ parentAgentId: "short", subagents }]
    })
  );
}
