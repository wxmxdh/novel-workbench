import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  LongLoveChapterWorkflowCommandEnvelopeSchema,
  createEnvelope,
  type CommandResult,
  type LongLoveChapterWorkflowCommandInput
} from "@deepwrite/contracts";
import { randomUUID } from "node:crypto";
import { piStrictToolSampling } from "../pi-tool-schema";
import { textResult } from "./shared";

type AuthorEvidence = { requestId: string; quote: string };
type WorkflowExecutor = (
  command: import("@deepwrite/contracts").LongLoveChapterWorkflowCommandEnvelope,
  signal?: AbortSignal
) => Promise<CommandResult>;

export function buildLoveChapterWorkflowTool(input: {
  bookId: string;
  sessionId: string;
  runId: string;
  executor: WorkflowExecutor;
  /** Parsed by Main from the current user's message; never model-supplied. */
  authorActionEvidence?: AuthorEvidence;
}): AgentTool {
  if (input.bookId !== "longbook_9a146bbe")
    throw new Error("LOVE章节接续工具只对LOVE书籍开放。");
  const parameters = Type.Object(
    {
      action: StringEnum([
        "prepare",
        "select_draft",
        "attach_notes",
        "read_notes",
        "redraft_context",
        "status"
      ] as const),
      chapter: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
      volume: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      draft_path: Type.Optional(
        Type.String({ minLength: 1, maxLength: 1_000 })
      ),
      draft_status: Type.Optional(
        StringEnum(["provisional", "selected"] as const)
      ),
      target_draft_path: Type.Optional(
        Type.String({ minLength: 1, maxLength: 1_000 })
      ),
      target_model: Type.Optional(
        Type.String({ minLength: 1, maxLength: 100 })
      ),
      note_paths: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
          maxItems: 20
        })
      ),
      annotation_item_ids: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
          maxItems: 200
        })
      )
    },
    { additionalProperties: false }
  );
  const tool: AgentTool<typeof parameters> = {
    name: "love_chapter_workflow",
    label: "准备 LOVE 章节接续材料",
    description:
      "LOVE章节接续入口。收到作者自然语言的批注回读/核对请求时，必须先调用 read_notes 并实际阅读成功返回的批注、被批注原稿全文和完整有效参考摘录；工具失败或未调用时，不得说已经读过。read_notes只读，不要求selected draft，不绑定、采用或修改任何状态。若交接明确单稿范围，传 target_draft_path 或 target_model 之一；自然模糊请求按稿件路径和SHA-256分组返回全部对象，不合并不同版本，并逐条标明失效项。先核对当前书籍确为LOVE、交接项目与LOVE一致；其它项目/磁盘路径不得映射成LOVE。大纲批注不得当作正文批注自动回读。status查看状态；prepare用于讨论和规划，读取本轮可用原生资料、已选前章全文及已选大纲；未选大纲或前章稿会明确标为缺失，不会替作者选择。select_draft只在Main从作者当前消息识别到明确选稿指令时可用；attach_notes只在Main识别到作者指定批注的当前原话后可用。annotation_item_ids只列作者本轮明确采用的条目，空列表仅绑定背景；网页状态（包括resolved）不等于采用。redraft_context要求Core本轮原生资料，只把复验有效的采用条目作为修订指令，未采用条目只作背景。不会猜测多稿、改正文或登记正典。",
    parameters,
    ...piStrictToolSampling(parameters),
    executionMode: "sequential",
    execute: async (_toolCallId, args, signal) => {
      const request: LongLoveChapterWorkflowCommandInput = {
        bookId: "longbook_9a146bbe",
        action: args.action,
        ...(args.chapter !== undefined ? { chapter: args.chapter } : {}),
        ...(args.volume ? { volume: args.volume } : {}),
        ...(args.draft_path ? { draftPath: args.draft_path } : {}),
        ...(args.draft_status ? { draftStatus: args.draft_status } : {}),
        ...(args.target_draft_path
          ? { targetDraftPath: args.target_draft_path }
          : {}),
        ...(args.target_model ? { targetModel: args.target_model } : {}),
        ...(args.note_paths ? { notePaths: args.note_paths } : {}),
        ...(args.annotation_item_ids !== undefined
          ? { annotationItemIds: args.annotation_item_ids }
          : {}),
        ...(["select_draft", "attach_notes"].includes(args.action) &&
        input.authorActionEvidence
          ? { authorActionEvidence: input.authorActionEvidence }
          : {})
      };
      if (
        ["select_draft", "attach_notes"].includes(request.action) &&
        !input.authorActionEvidence
      ) {
        throw new Error(
          "Main 未识别到当前作者明确选稿/指定批注的原话，只能读取接续状态或材料。"
        );
      }
      const command = LongLoveChapterWorkflowCommandEnvelopeSchema.parse(
        createEnvelope("long.loveChapterWorkflow", request, {
          id: `love-chapter-workflow-${randomUUID()}`,
          context: {
            sessionId: input.sessionId,
            runId: input.runId,
            resourceId: input.bookId
          }
        })
      );
      const result = await input.executor(command, signal);
      if (result.status !== "accepted")
        throw new Error(result.error?.message ?? "LOVE章节接续材料准备失败。");
      const payload = result.payload;
      if (
        !payload ||
        typeof payload !== "object" ||
        !("ok" in payload) ||
        (payload as { ok?: unknown }).ok !== true
      ) {
        throw new Error("Core没有返回有效的LOVE章节接续结果。");
      }
      if (
        "action" in payload &&
        (payload as { action?: unknown }).action !== request.action
      )
        throw new Error("Core返回的LOVE章节接续动作与请求不一致。");
      const resultLabel =
        request.action === "read_notes"
          ? "Core已返回只读批注回读结果"
          : `LOVE章节接续${request.action}已完成`;
      return textResult(
        `${resultLabel}。以下是Core只读回读返回的本次范围材料；请实际阅读每项内容和status/integrity后再讨论。缺失或needs_check必须明确说明，不能声称版本已核验；完整性提示对照已选大纲与正文场次结构，不评判文学质量。\n\n${JSON.stringify(payload, null, 2)}`
      );
    }
  };
  return tool;
}
