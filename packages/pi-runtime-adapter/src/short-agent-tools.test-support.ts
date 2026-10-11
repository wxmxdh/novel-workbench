import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  createDefaultCreativePlotStages,
  createShortWorkspaceContentRevision,
  type ShortWorkspaceSnapshot
} from "@deepwrite/contracts";
import { type ShortWorkspaceToolDetails } from "./short-agent-tools";

export function shortProfile() {
  return DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!;
}

export function expertSection(
  id: string,
  title: string,
  body: string,
  characterState = ""
) {
  return {
    id,
    title,
    wordCountRequirement: "1000 字",
    body: {
      documentId: `draft:${id}:body`,
      title,
      content: body,
      revision: createShortWorkspaceContentRevision(body)
    },
    characterState: {
      documentId: `draft:${id}:state`,
      title: `${title} · 人物状态`,
      content: characterState,
      revision: createShortWorkspaceContentRevision(characterState)
    }
  };
}

export function shortWorkspace(
  activeStageId: ShortWorkspaceSnapshot["activeStageId"] = "plot_design",
  options: {
    characterList?: boolean;
    truncatedCharacter?: boolean;
    plotContent?: string;
    truncatedPlot?: boolean;
  } = {}
): ShortWorkspaceSnapshot {
  const plotContent = options.plotContent ?? "旧剧情的唯一片段。";
  return {
    id: "short-tool-test",
    title: "雾港回声",
    categories: ["悬疑"],
    activeStageId,
    ...(activeStageId === "draft" ? { activeSectionId: "section-1" } : {}),
    characterStructure: options.characterList
      ? {
          format: "list",
          items: [
            {
              id: "character-lin",
              title: "林默",
              order: 1,
              content: "林默害怕迟到。",
              revision: createShortWorkspaceContentRevision("林默害怕迟到。"),
              ...(options.truncatedCharacter
                ? { truncated: true, originalLength: 100 }
                : {})
            },
            {
              id: "character-su",
              title: "苏遥",
              order: 2,
              content: "苏遥保管底片。",
              revision: createShortWorkspaceContentRevision("苏遥保管底片。")
            }
          ]
        }
      : { format: "text" },
    plotStages: createDefaultCreativePlotStages(),
    expertDraft: {
      id: "draft",
      title: "正文",
      revision: createShortWorkspaceContentRevision("draft-directory"),
      sections: [
        expertSection(
          "section-1",
          "第一节",
          "汽笛迟到了七分钟。",
          "林默拿到了钥匙。"
        ),
        expertSection("section-2", "第二节", "暗房显出了照片。")
      ]
    },
    stages: SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => {
      const content =
        stageId === "plot_design"
          ? plotContent
          : stageId === "character_design"
            ? "人物概览。"
            : "";
      return {
        stageId,
        title: stageId,
        content,
        revision: createShortWorkspaceContentRevision(content),
        ...(stageId === "plot_design" && options.truncatedPlot
          ? { truncated: true }
          : {})
      };
    })
  };
}

export function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

export function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter(
      (
        item
      ): item is Extract<(typeof result.content)[number], { type: "text" }> =>
        item.type === "text"
    )
    .map(({ text }) => text)
    .join("\n");
}

export function details(
  result: AgentToolResult<unknown>
): ShortWorkspaceToolDetails {
  return result.details as ShortWorkspaceToolDetails;
}
