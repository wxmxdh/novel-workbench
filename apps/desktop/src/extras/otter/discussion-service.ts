import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import type {
  OtterDiscussionInput,
  OtterDiscussionResult
} from "@deepwrite/contracts";
import type { OtterProjectAdapter } from "./project-adapter";
import type { createOtterProtocolService } from "./protocol-service";
import { discussionSources } from "./discussion-sources";

type DiscussionSourceMetadata = {
  path: string;
  role: string;
  authority?: string;
  purpose?: string;
  section?: string;
  entities?: string[];
  line_start?: number;
  line_end?: number;
};
type DiscussionBoundary = {
  chapter?: number;
  volume?: string;
  volumeConfirmation?: unknown;
  relevantCharacters?: string[];
  relevantRelationships?: string[];
  knowledgeBoundary?: string[];
  intentionalUnknowns?: string[];
  recentContext?: string[];
  authorInstructions?: string[];
  referenceScope?: string[];
  forbiddenFutureInfo?: string[];
};
type PreparedDiscussionInput = OtterDiscussionInput & {
  material?: string;
  sourceMetadata?: DiscussionSourceMetadata[];
  boundary?: DiscussionBoundary;
};

export async function prepareProjectDiscussion(
  adapter: OtterProjectAdapter,
  protocol: ReturnType<typeof createOtterProtocolService>,
  input: PreparedDiscussionInput
): Promise<OtterDiscussionResult> {
  await adapter.listProjects();
  const project = await adapter.resolveProject(input.projectId);
  const config = JSON.parse(
    (await adapter.readDocument(input.projectId, ".novel/project.json")).content
  ) as { project: string; chapter_state?: string };
  if (typeof config.project !== "string")
    throw new Error("当前作品缺少有效 V1 身份。");
  const automatic =
    input.targetPath || input.includeProjectPeople
      ? await discussionSources(
          adapter,
          input.projectId,
          config,
          input.targetPath,
          input.includeProjectPeople
        )
      : {
          sources: [],
          chapter: undefined,
          volume: undefined,
          volumeConfirmation: undefined
        };
  const selectedPaths = [
    ...new Set([
      ...input.sources,
      ...automatic.sources.map((source) => source.path)
    ])
  ];
  if (selectedPaths.length > 30)
    throw new Error(
      "本轮资料超过30份，请缩小审阅范围或分轮讨论；不会静默丢掉资料。"
    );
  const sources = await Promise.all(
    selectedPaths.map(async (path) => {
      if (!/\.(?:md|markdown|txt|json|jsonl|ya?ml|csv)$/i.test(path))
        throw new Error("讨论资料应选择文字文件；地图图片请使用配套说明。");
      const document = await adapter.readDocument(input.projectId, path);
      const authorCandidate =
        path.startsWith(".novel/notes/writing/") &&
        /^---\s*\r?\n[\s\S]*?\bworkbench: novel-author-candidate-v1\b/.test(
          document.content.slice(0, 16384)
        );
      const metadata =
        input.sourceMetadata?.find((source) => source.path === path) ??
        automatic.sources.find((source) => source.path === path);
      return {
        path,
        role: metadata?.role ?? "text",
        ...(metadata?.authority ? { authority: metadata.authority } : {}),
        section: metadata ? (metadata.section ?? "") : "full-source",
        ...(metadata?.entities ? { entities: metadata.entities } : {}),
        ...(metadata?.line_start !== undefined
          ? { line_start: metadata.line_start }
          : {}),
        ...(metadata?.line_end !== undefined
          ? { line_end: metadata.line_end }
          : {}),
        purpose: authorCandidate
          ? "作者填写的独立候选稿，仅供本轮讨论；不是有效大纲、正式 V1 交付或正典，不自动继承其中事实。"
          : (metadata?.purpose ??
            "作者主动选择的项目讨论资料；构想与参考不作为正式事实")
      };
    })
  );
  const nonce = randomUUID();
  const result = await protocol.workflow({
    projectId: input.projectId,
    action: "prepare",
    input: {
      project: config.project,
      task_id: `TASK-DISCUSS-${nonce}`,
      context_id: `CTX-DISCUSS-${nonce}`,
      task: "discussion",
      scope: "project",
      ...((automatic.chapter ?? input.boundary?.chapter)
        ? {
            chapter: automatic.chapter ?? input.boundary?.chapter,
            volume: automatic.volume ?? input.boundary?.volume,
            volume_confirmation:
              automatic.volumeConfirmation ?? input.boundary?.volumeConfirmation
          }
        : {}),
      pov: "项目讨论（未指定人物视角）",
      target: input.topic,
      relevant_characters: input.boundary?.relevantCharacters ?? [],
      relevant_relationships: input.boundary?.relevantRelationships ?? [],
      knowledge_boundary: input.boundary?.knowledgeBoundary ?? [],
      intentional_unknowns: input.boundary?.intentionalUnknowns ?? [],
      recent_context: input.boundary?.recentContext ?? [],
      author_instructions: [
        input.topic,
        ...(input.material
          ? [
              `作者选定的本轮讨论材料（待审/未定，不是事实）：\n${input.material}`
            ]
          : []),
        ...(input.boundary?.authorInstructions ?? []).map(
          (instruction) => `原任务作者要求与边界：${instruction}`
        ),
        "先列出本轮实际用于判断的大纲路径/版本、人物与关系来源，再逐项用来源段落核对。区分作者选定的执行大纲与本轮待审稿；未载入或未核对的内容标记未评估。读取收据只证明字节交付，不证明理解。不得只凭摘要或目录给全局已通过结论。",
        "只讨论当前Context绑定资料。未提供的时点、人物知识及留白保持未知；建议不得作为事实继承。正式章节写作需另行按 V1 准备。"
      ],
      skills_allowed: [...new Set(["otter-novel", ...(input.skills ?? [])])],
      reference_scope: input.boundary?.referenceScope ?? input.sources,
      forbidden_future_info: input.boundary?.forbiddenFutureInfo ?? [],
      sources
    }
  });
  if (!["PASS", "WARN"].includes(String(result.status)))
    throw new Error(
      typeof result.question === "string"
        ? result.question
        : "项目讨论准备未通过。"
    );
  const contextPath = relative(
    project.projectRoot,
    String(result.pack)
  ).replaceAll("\\", "/");
  const receiptPath = relative(
    project.projectRoot,
    String(result.receipt)
  ).replaceAll("\\", "/");
  return {
    projectId: input.projectId,
    contextPath,
    receiptPath,
    contextId: `CTX-DISCUSS-${nonce}`,
    status: result.status as "PASS" | "WARN"
  };
}
