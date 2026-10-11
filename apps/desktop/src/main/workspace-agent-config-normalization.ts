import {
  SCRIPT_MATERIAL_KINDS,
  SCRIPT_SKILL_KINDS,
  SHORT_MATERIAL_KINDS,
  SHORT_SKILL_KINDS,
  ScriptAgentReadAccessSchema,
  ScriptWorkspaceAgentSettingsInputSchema,
  ShortAgentReadAccessSchema,
  ShortWorkspaceAgentSettingsInputSchema,
  type ScriptWorkspaceAgentSettingsInput,
  type ShortWorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import {
  cloneReadAccess,
  cloneScriptReadAccess,
  cloneScriptWelcomeShortcuts,
  cloneWelcomeShortcuts,
  defaultsAsInput,
  scriptDefaultsAsInput
} from "./workspace-agent-config-helpers";

function legacyReadAccess(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const access = raw as Record<string, unknown>;
  return { material: access.material, skill: access.skill };
}

export function normalizeShortWorkspaceAgentDisk(
  raw: unknown
): ShortWorkspaceAgentSettingsInput {
  if (raw === undefined) return defaultsAsInput();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("短篇智能体配置内容无效，未覆盖原文件。");
  }
  const candidate = raw as Record<string, unknown>;
  if (
    candidate.version === 5 ||
    candidate.version === 4 ||
    candidate.version === 3
  ) {
    const defaults = defaultsAsInput();
    const parsed = ShortWorkspaceAgentSettingsInputSchema.safeParse({
      workspaceType: candidate.workspaceType,
      defaultPlotStageIds:
        candidate.version === 5
          ? candidate.defaultPlotStageIds
          : defaults.defaultPlotStageIds,
      agents: candidate.agents
    });
    if (!parsed.success) {
      throw new Error("短篇智能体配置内容无效，未覆盖原文件。");
    }
    const builtin = defaults.agents[0]!;
    return {
      workspaceType: "short",
      defaultPlotStageIds: [...parsed.data.defaultPlotStageIds],
      agents: parsed.data.agents.map((agent) => ({
        ...agent,
        ...(candidate.version === 3
          ? { systemPrompt: builtin.systemPrompt }
          : {}),
        welcomeShortcuts: cloneWelcomeShortcuts(agent.welcomeShortcuts),
        readAccess: cloneReadAccess(agent.readAccess)
      }))
    };
  }

  if (candidate.workspaceType !== "short" || !Array.isArray(candidate.agents)) {
    throw new Error("短篇智能体配置内容无效，未覆盖原文件。");
  }
  const records = candidate.agents.filter(
    (agent): agent is Record<string, unknown> =>
      Boolean(agent) && typeof agent === "object" && !Array.isArray(agent)
  );
  const order = ["character_design", "plot_design", "expert_draft_coordinator"];
  const legacy = records
    .filter((record) => order.includes(String(record.id)))
    .sort(
      (left, right) =>
        order.indexOf(String(left.id)) - order.indexOf(String(right.id))
    );
  if (
    records.length !== candidate.agents.length ||
    legacy.length !== order.length ||
    new Set(legacy.map((record) => String(record.id))).size !== order.length
  ) {
    throw new Error("短篇智能体配置迁移失败，未覆盖原文件。");
  }

  const material = new Set<(typeof SHORT_MATERIAL_KINDS)[number]>();
  const skill = new Set<(typeof SHORT_SKILL_KINDS)[number]>();
  for (const record of legacy) {
    const access = ShortAgentReadAccessSchema.safeParse(
      legacyReadAccess(record.readAccess)
    );
    if (!access.success) {
      throw new Error("短篇智能体配置迁移失败，未覆盖原文件。");
    }
    access.data.material.forEach((kind) => material.add(kind));
    access.data.skill.forEach((kind) => skill.add(kind));
  }
  const builtin = defaultsAsInput().agents[0]!;
  return {
    workspaceType: "short",
    defaultPlotStageIds: [...defaultsAsInput().defaultPlotStageIds],
    agents: [
      {
        ...builtin,
        readAccess: { material: [...material], skill: [...skill] }
      }
    ]
  };
}

export function normalizeScriptWorkspaceAgentDisk(
  raw: unknown
): ScriptWorkspaceAgentSettingsInput {
  if (raw === undefined) return scriptDefaultsAsInput();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("剧本智能体配置内容无效，未覆盖原文件。");
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.version === 4 || candidate.version === 3) {
    const parsed = ScriptWorkspaceAgentSettingsInputSchema.safeParse({
      workspaceType: candidate.workspaceType,
      agents: candidate.agents
    });
    if (!parsed.success) {
      throw new Error("剧本智能体配置内容无效，未覆盖原文件。");
    }
    const builtin = scriptDefaultsAsInput().agents[0]!;
    return {
      workspaceType: "script",
      agents: parsed.data.agents.map((agent) => ({
        ...agent,
        ...(candidate.version === 3
          ? { systemPrompt: builtin.systemPrompt }
          : {}),
        welcomeShortcuts: cloneScriptWelcomeShortcuts(agent.welcomeShortcuts),
        readAccess: cloneScriptReadAccess(agent.readAccess)
      }))
    };
  }

  if (
    candidate.workspaceType !== "script" ||
    !Array.isArray(candidate.agents)
  ) {
    throw new Error("剧本智能体配置内容无效，未覆盖原文件。");
  }
  const records = candidate.agents.filter(
    (agent): agent is Record<string, unknown> =>
      Boolean(agent) && typeof agent === "object" && !Array.isArray(agent)
  );
  const order = ["character_design", "plot_design", "expert_draft_coordinator"];
  const legacy = records
    .filter((record) => order.includes(String(record.id)))
    .sort(
      (left, right) =>
        order.indexOf(String(left.id)) - order.indexOf(String(right.id))
    );
  if (
    records.length !== candidate.agents.length ||
    legacy.length !== order.length ||
    new Set(legacy.map((record) => String(record.id))).size !== order.length
  ) {
    throw new Error("剧本智能体配置迁移失败，未覆盖原文件。");
  }

  const material = new Set<(typeof SCRIPT_MATERIAL_KINDS)[number]>();
  const skill = new Set<(typeof SCRIPT_SKILL_KINDS)[number]>();
  for (const record of legacy) {
    const access = ScriptAgentReadAccessSchema.safeParse(
      legacyReadAccess(record.readAccess)
    );
    if (!access.success) {
      throw new Error("剧本智能体配置迁移失败，未覆盖原文件。");
    }
    access.data.material.forEach((kind) => material.add(kind));
    access.data.skill.forEach((kind) => skill.add(kind));
  }
  const builtin = scriptDefaultsAsInput().agents[0]!;
  const migrated = ScriptWorkspaceAgentSettingsInputSchema.safeParse({
    workspaceType: "script",
    agents: [
      {
        ...builtin,
        readAccess: { material: [...material], skill: [...skill] }
      }
    ]
  });
  if (!migrated.success) {
    throw new Error("剧本智能体配置迁移失败，未覆盖原文件。");
  }
  return migrated.data;
}
