import type { InjectionKey, ShallowRef } from "vue";
import type { OtterContextRef } from "@deepwrite/contracts";
import type { NovelWorkspacePort } from "./novelWorkspacePort";

export const novelCategories = {
  discussion: "自由讨论",
  character: "人物",
  relationship: "关系",
  world: "世界观",
  timeline: "时间线",
  concept: "情节与构想",
  plan: "大纲",
  draft: "正文",
  "writing-support": "写作资料",
  annotation: "批注",
  canon: "有效设定",
  map: "地图",
  entry: "项目入口",
  protocol: "工作流程",
  workflow: "任务与计划记录"
} as const;

export type NovelCategory = keyof typeof novelCategories;
export const novelCategoryGroups = [
  {
    id: "reference",
    label: "资料",
    categories: [
      "character",
      "relationship",
      "world",
      "timeline",
      "canon",
      "map"
    ]
  },
  {
    id: "writing",
    label: "写作",
    categories: ["concept", "plan", "draft", "annotation", "writing-support"]
  },
  {
    id: "project-info",
    label: "项目说明",
    categories: ["entry", "protocol", "workflow"]
  }
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  categories: readonly NovelCategory[];
}>;
export type NovelContext = OtterContextRef & { contextId: string };

export function novelResourceId(
  projectId: string,
  category: NovelCategory = "discussion",
  path = ""
): string {
  return `novel:${encodeURIComponent(projectId)}:${category}:${encodeURIComponent(path)}`;
}

export function parseNovelResource(
  id: string
): { projectId: string; category: NovelCategory; path: string } | null {
  const parts = id.split(":");
  if (
    parts.length !== 4 ||
    parts[0] !== "novel" ||
    !(parts[2]! in novelCategories)
  )
    return null;
  try {
    return {
      projectId: decodeURIComponent(parts[1]!),
      category: parts[2] as NovelCategory,
      path: decodeURIComponent(parts[3]!)
    };
  } catch {
    return null;
  }
}

export const NOVEL_WORKSPACE_PORT: InjectionKey<
  ShallowRef<NovelWorkspacePort | null>
> = Symbol("novelWorkspacePort");
