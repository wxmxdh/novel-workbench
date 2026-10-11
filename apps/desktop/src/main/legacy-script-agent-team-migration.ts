import {
  SCRIPT_AGENT_SUBAGENT_MAX_COUNT,
  ScriptAgentTeamSettingsInputSchema,
  type ScriptAgentTeamSettings
} from "@deepwrite/contracts";
import {
  chunkLegacyAgentTeamDefinitions,
  collectLegacyAgentTeamDefinitions
} from "./legacy-agent-team-migration";

const LEGACY_SCRIPT_PARENT_LABELS = {
  character_design: "人物",
  plot_design: "剧情",
  outline: "大纲",
  expert_draft_coordinator: "正文",
  expert_section_writer: "单节写手",
  script: "剧本"
} as const;

const LEGACY_SCRIPT_PARENT_SETS = [
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

export function migrateLegacyScriptAgentTeamSettings(
  raw: Record<string, unknown>
): ScriptAgentTeamSettings[] | undefined {
  const current = ScriptAgentTeamSettingsInputSchema.safeParse(raw);
  if (current.success) return [current.data];
  const definitions = collectLegacyAgentTeamDefinitions(raw, {
    workspaceType: "script",
    parentLabels: LEGACY_SCRIPT_PARENT_LABELS,
    parentSets: LEGACY_SCRIPT_PARENT_SETS
  });
  if (!definitions) return undefined;
  return chunkLegacyAgentTeamDefinitions(
    definitions,
    SCRIPT_AGENT_SUBAGENT_MAX_COUNT
  ).map((subagents) =>
    ScriptAgentTeamSettingsInputSchema.parse({
      workspaceType: "script",
      teams: [{ parentAgentId: "script", subagents }]
    })
  );
}
