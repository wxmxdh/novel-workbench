import {
  createEnvelope,
  LongLoveChapterWorkflowCommandEnvelopeSchema
} from "@deepwrite/contracts";
import type { AgentRunInput } from "./runtime-types";
import { randomUUID } from "node:crypto";

function chapter(text: string): number | undefined {
  const token = text.match(
    /第\s*([0-9一二三四五六七八九十百零〇两]+)\s*章/u
  )?.[1];
  if (!token) return undefined;
  if (/^\d+$/u.test(token)) return Number(token) || undefined;
  const values: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    零: 0,
    〇: 0
  };
  let total = 0,
    digit = 0;
  for (const char of token) {
    if (char === "十" || char === "百") {
      total += (digit || 1) * (char === "十" ? 10 : 100);
      digit = 0;
    } else digit = values[char] ?? 0;
  }
  return total + digit || undefined;
}

function isAnnotationReadRequest(text: string): boolean {
  if (
    /(?:批注).{0,24}(?:流程|功能|接口|程序|代码|工作台)|(?:流程|功能|接口|程序|代码|工作台).{0,24}批注/u.test(
      text
    )
  )
    return false;
  if (annotationReadDeclined(text)) return false;
  return (
    /批注/u.test(text) && /(?:回读|核对|查看|读取|阅读|读|看|浏览)/u.test(text)
  );
}

function annotationReadDeclined(text: string): boolean {
  return /(?:不要|别|暂不|先不|不想|不用|不必|不需要|不)(?:再|先|去|帮我|\s){0,6}(?:看|读|读取|阅读|核对|回读)[^。！？\r\n]{0,24}批注/u.test(
    text
  );
}

const handoffLabels =
  "项目(?:根目录|名称|ID)?|作品(?:名称)?|类型|卷章|本次批注模型|作者批注入口|批注文件|批注对应的稿件|大纲来源";

function handoffField(text: string, label: string): string | undefined {
  const match = text.match(
    new RegExp(
      `${/^作者批注回读/u.test(text.trim()) ? "" : "(?:^|\\s)"}${label}\\s*[：:]\\s*([^\\r\\n]*?)(?=\\s*(?:${handoffLabels})\\s*[：:]|\\r?\\n|$)`,
      "imu"
    )
  );
  const value = match?.[1];
  return value ? unwrapFieldValue(value) : undefined;
}

function explicitProjectMismatch(text: string): string | undefined {
  for (const label of [
    "项目",
    "项目根目录",
    "项目名称",
    "项目ID",
    "作品",
    "作品名称"
  ]) {
    const value = handoffField(text, label);
    if (!value) continue;
    const projectLeaf = value.split(/[\\/]/u).filter(Boolean).at(-1) ?? value;
    if (
      projectLeaf.toLocaleUpperCase("en-US") !== "LOVE" &&
      !/longbook_9a146bbe/iu.test(value)
    )
      return value;
  }
  if (
    /What\s+Is\s+Love/iu.test(text) &&
    !/\bLOVE\b/iu.test(text.replace(/What\s+Is\s+Love/giu, ""))
  )
    return "What Is Love";
  return undefined;
}

function unwrapFieldValue(value: string): string {
  let result = value.trim();
  if (
    (result.startsWith("`") && result.endsWith("`")) ||
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  )
    result = result.slice(1, -1).trim();
  return result.replace(/[，,；;]+$/u, "").trim();
}

function annotationReadTarget(text: string): {
  targetDraftPath?: string;
  targetModel?: string;
} {
  const normalizedModel = handoffField(text, "本次批注模型") ?? "";
  const targetModel =
    normalizedModel && !/^(?:unknown|未知|未标模型)$/iu.test(normalizedModel)
      ? normalizedModel
      : undefined;
  const rootValue = handoffField(text, "项目根目录");
  const root = rootValue
    ? rootValue.replaceAll("\\", "/").replace(/\/+$/u, "")
    : "";
  if (!root) return targetModel ? { targetModel } : {};

  const rootPrefix = `${root}/`;
  const targetPaths = new Set<string>();
  const section =
    text.match(
      /批注对应的稿件\s*[：:]([\s\S]*?)(?:大纲来源\s*[：:]|请读取完整批注|$)/u
    )?.[1] ?? "";
  const normalizedSection = section.replaceAll("\\", "/");
  const lowerSection = normalizedSection.toLocaleLowerCase("en-US");
  const lowerRoot = rootPrefix.toLocaleLowerCase("en-US");
  let searchFrom = 0;
  while (searchFrom < normalizedSection.length) {
    const rootIndex = lowerSection.indexOf(lowerRoot, searchFrom);
    if (rootIndex < 0) break;
    const start = rootIndex + rootPrefix.length;
    const pathEnd = normalizedSection
      .slice(start)
      .match(/\.md(?=[\s`'"<>，,；;-]|$)/iu);
    searchFrom = start;
    if (pathEnd?.index === undefined) continue;
    const end = start + pathEnd.index + 3;
    const relativePath = normalizedSection.slice(start, end).trim();
    searchFrom = end;
    const parts = relativePath.split("/");
    if (
      parts[0] === "004_写作中" &&
      parts.every(
        (part) => !!part && part !== "." && part !== ".." && !part.includes(":")
      ) &&
      /\.md$/iu.test(relativePath)
    )
      targetPaths.add(relativePath);
  }
  const onlyPath = targetPaths.size === 1 ? [...targetPaths][0] : undefined;
  if (onlyPath) return { targetDraftPath: onlyPath };
  return targetModel ? { targetModel } : {};
}

function annotationTypeIsOutline(text: string): boolean {
  return handoffField(text, "类型") === "大纲";
}

/** Read-only source acquisition; it grants no writing or canon capability. */
export function createLoveWorkflowStart(input: AgentRunInput):
  | {
      load(signal: AbortSignal): Promise<void>;
      context(): string;
    }
  | undefined {
  if (
    input.workspaceContext?.longWorkspace?.bookId !== "longbook_9a146bbe" ||
    !input.longCommandExecutor ||
    input.workspaceContext.subagentAuthoring
  )
    return undefined;
  const plain = input.prompt
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/^\s*>.*$/gmu, "");
  if (annotationReadDeclined(plain)) return undefined;
  if (!/(?:讨论|规划|大纲|开始|我要写|写|创作|续写|批注|修订)/u.test(plain))
    return undefined;
  const chapterNumber = chapter(plain);
  if (!chapterNumber) return undefined;
  let actualContext = "";
  const otherProject = explicitProjectMismatch(plain);
  if (otherProject) {
    actualContext = `【LOVE资料读取已停止】交接中标注的项目为“${otherProject}”，与当前书籍 LOVE 不一致；没有读取该项目或LOVE的批注。请先确认目标书籍后再继续。`;
    return {
      async load() {},
      context: () => actualContext
    };
  }
  if (isAnnotationReadRequest(plain) && annotationTypeIsOutline(plain)) {
    actualContext =
      "【LOVE批注回读未执行】交接对象明确为大纲，本入口的read_notes只读取正文稿批注；没有自动读取正文批注或把大纲意见映射到正文。请通过大纲审阅入口核对该对象，或明确指定正文批注。";
    return {
      async load() {},
      context: () => actualContext
    };
  }
  const readTarget = isAnnotationReadRequest(plain)
    ? annotationReadTarget(plain)
    : undefined;
  const executor = input.longCommandExecutor;
  async function request(
    action: "status" | "prepare" | "read_notes",
    volume?: string,
    signal?: AbortSignal,
    target?: { targetDraftPath?: string; targetModel?: string }
  ) {
    const command = LongLoveChapterWorkflowCommandEnvelopeSchema.parse(
      createEnvelope(
        "long.loveChapterWorkflow",
        {
          bookId: "longbook_9a146bbe",
          action,
          chapter: chapterNumber,
          ...(volume ? { volume } : {}),
          ...(action === "read_notes" && target?.targetDraftPath
            ? { targetDraftPath: target.targetDraftPath }
            : {}),
          ...(action === "read_notes" &&
          !target?.targetDraftPath &&
          target?.targetModel
            ? { targetModel: target.targetModel }
            : {})
        },
        {
          id: `love-start-${randomUUID()}`,
          context: {
            sessionId: input.sessionId,
            runId: input.runId,
            resourceId: "longbook_9a146bbe"
          }
        }
      )
    );
    const result = await executor(command, signal);
    if (result.status !== "accepted")
      throw new Error(result.error?.message ?? "接续资料无法读取");
    return result.payload as Record<string, unknown>;
  }
  return {
    async load(signal) {
      try {
        const status = await request("status", undefined, signal);
        const catalog = Array.isArray(status.chapterCatalog)
          ? status.chapterCatalog
          : [];
        const volumes = [
          ...new Set(
            catalog
              .filter(
                (entry: { chapter?: number; volume?: string }) =>
                  Number(entry.chapter) === chapterNumber
              )
              .map((entry: { volume?: string }) => entry.volume)
              .filter(
                (volume): volume is string =>
                  typeof volume === "string" && !!volume
              )
          )
        ];
        const explicitVolume =
          plain.match(/第[0-9一二三四五六七八九十百]+卷/u)?.[0];
        const allVolumes = [
          ...new Set(
            catalog
              .map((entry: { volume?: string }) => entry.volume)
              .filter(
                (volume): volume is string =>
                  typeof volume === "string" && !!volume
              )
          )
        ];
        const provisional =
          volumes.length === 0 && !explicitVolume && allVolumes.length === 1;
        const volume = explicitVolume
          ? allVolumes.find((value) => value === explicitVolume)
          : volumes.length === 1
            ? volumes[0]
            : provisional
              ? allVolumes[0]
              : undefined;
        if (!volume) {
          actualContext = `【运行器接续资料缺项】第${chapterNumber}章尚无唯一已登记卷次，或作者指定卷与登记不符。先用love_chapter_workflow status核对，不猜选前章，不宣称已读前章全文；可以继续询问/规划讨论。`;
          return;
        }
        if (isAnnotationReadRequest(plain)) {
          const packet = await request(
            "read_notes",
            volume,
            signal,
            readTarget
          );
          actualContext = `【运行器已通过Core只读回读LOVE作者批注】请先实际阅读以下本轮全文，再逐条讨论。失败时不得声称已读；本次只读，不选择底稿、不采用批注、不写完成状态或正典。跨稿摘录是作者为该意见选择的局部参考，按验证后的原文完整呈现。
${JSON.stringify(packet, null, 2)}`;
          return;
        }
        const packet = await request("prepare", volume, signal);
        actualContext = `【运行器实际读取的LOVE接续材料】以下是Core本轮取得的前章/大纲/批注全文及版本，必须实际阅读。${provisional ? "当前章未登记，暂按本书唯一已登记卷准备规划讨论；这不是新卷章正文授权或正式卷次确认。" : ""}缺项只限制所缺资料对应执行，不扩大成故事禁令。\n${JSON.stringify(packet, null, 2)}`;
      } catch (error) {
        signal.throwIfAborted();
        actualContext = `【运行器接续资料读取失败】${error instanceof Error ? error.message : String(error)}。不得声称已取得全文或已通过写作准备；可报告缺项并继续不依赖缺项的讨论。`;
      }
    },
    context: () => actualContext
  };
}
