import type { OtterDiscussionResult } from "@deepwrite/contracts";
export function contextRef(context: OtterDiscussionResult) {
  return {
    projectId: context.projectId,
    contextPath: context.contextPath,
    ...(context.receiptPath ? { receiptPath: context.receiptPath } : {})
  };
}

export type TeamRunSelection = {
  context: OtterDiscussionResult;
  topic: string;
  nativeTeamIds: string[];
  memberKeys: string[];
  mode: "review" | "ideas";
  targetPath?: string;
  includeProjectPeople: boolean;
};

// A request is only routed to the picker. It is never evidence of team execution.
export function requestsTeam(topic: string): boolean {
  return /(?:调用|请|让|用|交给|启动).{0,16}(?:智能体团队|团队|多模型).{0,24}(?:审|复核|检查|讨论|发散|写|看)|(?:团队|多模型).{0,12}(?:审阅|审核|复核|讨论|发散)|(?:call|use|ask).{0,20}(?:team|agents).{0,30}(?:review|audit|discuss)/i.test(
    topic
  );
}

export function inspectSources(apiText: string) {
  const pack = JSON.parse(apiText) as {
    sources?: Array<{
      path: string;
      role: string;
      authority?: string;
      hash?: string;
      content?: string;
      line_start: number;
      line_end: number;
    }>;
    navigation?: { must_read: Array<{ path: string; mustReadFully: boolean }> };
    metadata?: {
      selectedOutline?: { path: string; hash?: string; version?: string };
      volume?: string;
      chapter?: number;
    };
  };
  const outline = pack.metadata?.selectedOutline;
  const outlineSource = outline?.hash
    ? pack.sources?.find(
        (source) => source.path === outline.path && source.hash === outline.hash
      )
    : undefined;
  // V1's Context records path/hash; its routing result additionally has version.
  // Read only the matching delivered header, never infer from a filename.
  const header = outlineSource?.content
    ?.replace(/^\uFEFF/, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const outlineVersion =
    outline?.version ??
    header?.[1]?.match(/^version:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim();
  return {
    sources: (pack.sources ?? []).map((source) => ({
      ...source,
      full:
        pack.navigation?.must_read.find((item) => item.path === source.path)
          ?.mustReadFully ?? false
    })),
    selectedOutline: outline
      ? `${outline.path}${outlineVersion ? ` · v${outlineVersion}` : ""}`
      : undefined,
    volume: pack.metadata?.volume,
    chapter: pack.metadata?.chapter
  };
}
