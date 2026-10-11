import type {
  AgentTeamCatalogSnapshot,
  LongAgentId,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { createHash } from "node:crypto";

export type ActiveLongTeamMember = {
  teamName: string;
  memberName: string;
  memberId: string;
  role: string;
  modelId?: string;
  thinkingLevel?: ShortAgentSubagentDefinition["thinkingLevel"];
  temperature?: number;
};

/** Read-only projection of the enabled original long-form team for one parent. */
export function mapActiveLongTeamMembers(
  snapshot: AgentTeamCatalogSnapshot,
  parentAgentId: LongAgentId,
  selectedTeamIds?: string[],
  memberKeys?: string[]
): ActiveLongTeamMember[] {
  if (selectedTeamIds) {
    if (new Set(selectedTeamIds).size !== selectedTeamIds.length)
      throw new Error("不能重复选择同一团队。");
    const keys = new Set<string>();
    const members = selectedTeamIds.flatMap((id) => {
      const profile = snapshot.teams.find((team) => team.id === id);
      if (!profile || profile.workspaceType !== "long")
        throw new Error("所选长篇团队已变化，请重新选择。");
      const parent = profile.settings.teams.find(
        (team) => team.parentAgentId === parentAgentId
      );
      return (parent?.subagents ?? [])
        .filter((member) => member.enabled)
        .flatMap((member) => {
          const key = `${profile.id}/${member.id}`;
          keys.add(key);
          if (memberKeys && !memberKeys.includes(key)) return [];
          return [
            {
              teamName: profile.name,
              memberName: member.name,
              // Different saved teams may reuse role IDs; never merge their sessions.
              memberId: `selected-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`,
              role: member.systemPrompt,
              ...(member.modelMode === "custom" && member.modelId
                ? { modelId: member.modelId }
                : {}),
              ...(member.modelMode === "custom" && member.thinkingLevel
                ? { thinkingLevel: member.thinkingLevel }
                : {}),
              ...(member.modelMode === "custom" &&
              member.temperature !== undefined
                ? { temperature: member.temperature }
                : {})
            }
          ];
        });
    });
    if (
      memberKeys?.some((key) => !keys.has(key)) ||
      (memberKeys && new Set(memberKeys).size !== memberKeys.length)
    )
      throw new Error("所选职责已变化或重复，请重新选择。");
    return members;
  }
  if (memberKeys) throw new Error("选择职责时必须明确选择团队。");
  const activeId = snapshot.enabledTeamIds.long;
  if (!activeId) throw new Error("请先在模型与团队中启用长篇团队。");
  const profile = snapshot.teams.find((team) => team.id === activeId);
  if (!profile || profile.workspaceType !== "long")
    throw new Error("当前启用的长篇团队配置无效，请重新启用团队。");
  const parent = profile.settings.teams.find(
    (team) => team.parentAgentId === parentAgentId
  );
  if (!parent) throw new Error("当前长篇智能体没有团队配置。");
  return parent.subagents
    .filter((member) => member.enabled)
    .map((member) => ({
      teamName: profile.name,
      memberName: member.name,
      memberId: member.id,
      role: member.systemPrompt,
      ...(member.modelMode === "custom" && member.modelId
        ? { modelId: member.modelId }
        : {}),
      ...(member.modelMode === "custom" && member.thinkingLevel
        ? { thinkingLevel: member.thinkingLevel }
        : {}),
      ...(member.modelMode === "custom" && member.temperature !== undefined
        ? { temperature: member.temperature }
        : {})
    }));
}
