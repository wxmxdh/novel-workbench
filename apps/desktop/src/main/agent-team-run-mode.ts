import type {
  AgentProviderRuntimeConfig,
  AgentTeamRunMode,
  AgentTeamWorkspaceType,
  ShortAgentSubagentDefinition,
  WorkspaceAgentId
} from "@deepwrite/contracts";
import { assertModelRunSettings } from "./model-run-settings";

export interface AgentTeamRunTarget {
  workspaceType: AgentTeamWorkspaceType;
  parentAgentId: WorkspaceAgentId | "long";
  bookId?: string;
}

export interface AgentTeamRunModeDependencies {
  resolveDefinitions(
    workspaceType: AgentTeamWorkspaceType,
    parentAgentId: WorkspaceAgentId | "long"
  ): Promise<ShortAgentSubagentDefinition[]>;
  resolveModel(
    modelId: string
  ): Promise<AgentProviderRuntimeConfig | undefined>;
}

export interface ResolvedAgentTeamRuntime {
  subagentDefinitions?: ShortAgentSubagentDefinition[];
  subagentRuntimeConfigs: Record<string, AgentProviderRuntimeConfig>;
}

export async function resolveAgentTeamRuntime(
  mode: AgentTeamRunMode | undefined,
  target: AgentTeamRunTarget | undefined,
  dependencies: AgentTeamRunModeDependencies
): Promise<ResolvedAgentTeamRuntime> {
  if (mode !== "team") {
    return { subagentRuntimeConfigs: {} };
  }
  if (!target) {
    throw new Error("团队模式仅适用于短篇、剧本或长篇创作智能体。");
  }

  const subagentDefinitions = await dependencies.resolveDefinitions(
    target.workspaceType,
    target.parentAgentId
  );
  if (
    subagentDefinitions.some((definition) =>
      definition.id.startsWith("love-")
    ) &&
    (target.workspaceType !== "long" || target.bookId !== "longbook_9a146bbe")
  ) {
    throw new Error(
      "Love 现实主义青春题材 创作团队仅适用于 LOVE；其它作品请在智能体团队设置中选择对应团队。"
    );
  }
  if (subagentDefinitions.length === 0) {
    throw new Error(
      "当前智能体没有已启用且含可用成员的团队，请先在“智能体团队”中完成配置。"
    );
  }

  const subagentRuntimeConfigs: Record<string, AgentProviderRuntimeConfig> = {};
  for (const definition of subagentDefinitions) {
    if (definition.modelMode !== "custom" || !definition.modelId) continue;
    const resolved =
      subagentRuntimeConfigs[definition.modelId] ??
      (await dependencies.resolveModel(definition.modelId));
    if (!resolved) {
      throw new Error(
        `子智能体「${definition.name}」配置的模型不存在，请刷新模型配置后重试。`
      );
    }
    assertModelRunSettings(resolved, {
      thinkingLevel: definition.thinkingLevel,
      temperature: definition.temperature
    });
    subagentRuntimeConfigs[definition.modelId] = resolved;
  }

  return { subagentDefinitions, subagentRuntimeConfigs };
}
