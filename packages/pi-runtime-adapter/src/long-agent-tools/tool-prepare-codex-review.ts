import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import {
  LongPrepareCodexReviewCommandEnvelopeSchema,
  createEnvelope
} from "@deepwrite/contracts";
import {
  defineTool,
  requireAccepted,
  requireExecutor,
  textResult
} from "./shared";
import { documentParameter, entityIdParameter, strictObject } from "./schemas";
import { longEntityKindForId } from "./entity-registry";
import { resolveLongTarget } from "./target";
import type { LongToolContext } from "./context";

const LOVE_BOOK_ID = "longbook_9a146bbe";

function handoffStatus(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "无法读取打包器覆盖状态；请人工核对输出。";
  }
  const value = payload as {
    packageDir?: unknown;
    coverage?: {
      reviewReady?: unknown;
      reviewCoverageComplete?: unknown;
      explicitTargetCount?: unknown;
      issues?: unknown;
      dialogue?: {
        selectedSessionId?: unknown;
        latestSavedAssistantMessage?: unknown;
      };
    };
  };
  const coverage = value.coverage;
  const explicitTargetCount =
    typeof coverage?.explicitTargetCount === "number"
      ? coverage.explicitTargetCount
      : null;
  const status =
    coverage?.reviewReady === true
      ? explicitTargetCount === 0
        ? "候选会话资料完整；当前对象仅为保存的对话候选"
        : "显式目标资料完整"
      : "资料未完整就绪";
  const lines = [
    `审核状态：${status}`,
    `已保存任务执行记录无已知缺项：${coverage?.reviewCoverageComplete === true ? "是" : "否"}`,
    "当前稿件版本的专项审阅覆盖：仍须核对每份报告实际对象；执行记录齐全不表示新版已全部重审或文学质量通过。",
    `显式目标文件数：${explicitTargetCount ?? "未知"}`,
    `本次会话：${typeof coverage?.dialogue?.selectedSessionId === "string" ? coverage.dialogue.selectedSessionId : "未返回"}`,
    `资料包：${typeof value.packageDir === "string" ? value.packageDir : "位置未返回"}`
  ];
  const candidate = coverage?.dialogue?.latestSavedAssistantMessage;
  if (candidate && typeof candidate === "object") {
    const item = candidate as { messageId?: unknown; position?: unknown };
    lines.push(
      `最近已保存的主 AI 消息候选：${typeof item.messageId === "string" ? item.messageId : "消息 ID 未知"}${typeof item.position === "number" ? `（位置 ${item.position}）` : ""}；这只是会话候选，不代表大纲选择或作者批准。`
    );
  } else {
    lines.push(
      "没有匹配到可引用的已保存主 AI 消息候选；未推断大纲或批准状态。"
    );
  }
  if (Array.isArray(coverage?.issues) && coverage.issues.length > 0) {
    lines.push(
      "未解决项：",
      ...coverage.issues.map((issue) => `- ${String(issue)}`)
    );
  }
  if (coverage?.reviewReady !== true) {
    lines.push(
      "交接包已生成，但目前不能报告为完整就绪；请先处理未解决项并明确审核目标。"
    );
  }
  if (explicitTargetCount === 0) {
    lines.push(
      "未选择大纲或文件目标；仅标记当前会话候选，不代表选定或批准任何大纲。"
    );
  }
  return lines.join("\n");
}

export function buildPrepareCodexReviewTool(
  ctx: LongToolContext
): AgentTool | undefined {
  if (ctx.workspace.bookId !== LOVE_BOOK_ID) return undefined;
  return defineTool({
    name: "prepare_codex_review",
    label: "打包 Codex 交接",
    description:
      "作者明确要求交给 Codex 审核，或要求给 Codex 接续写作提示词/资料交接时调用。默认 purpose=review 从当前授权 LOVE 会话生成审核包；写作接续用 purpose=draft_handoff、chapter=具体章号，可传 volume；从本项目当前登记核对大纲、原生资料与版本，生成可复制给新 Codex 对话的提示词。写作交接不接受 target/target_id/document，不生成正文，不授予新故事事实正典效力。scope 描述交接范围。审核单章可提供 target_id=<章卡 id> 和 document=body|card，或显式项目内相对路径 target，不能同时提供两种目标。无审核目标只标记会话候选，不推断作者批准。",
    parameters: strictObject({
      scope: Type.String({ minLength: 1, maxLength: 2000 }),
      purpose: Type.Optional(StringEnum(["review", "draft_handoff"])),
      chapter: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
      volume: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      target: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      target_id: Type.Optional(entityIdParameter),
      document: Type.Optional(documentParameter)
    }),
    execute: async (_id, params, signal) => {
      let target = params.target;
      let scope = params.scope;
      if (params.purpose === "draft_handoff") {
        if (
          !params.chapter ||
          params.target ||
          params.target_id ||
          params.document
        ) {
          throw new Error(
            "写作交接需要 chapter；不接受替代 target/target_id/document。"
          );
        }
      } else if (params.chapter || params.volume) {
        throw new Error("chapter/volume 只用于写作接续交接。");
      }
      if (target && (params.target_id || params.document)) {
        throw new Error("显式 target 路径与 target_id/document 不能同时使用。");
      }
      if (params.target_id || params.document) {
        if (!params.target_id || !params.document) {
          throw new Error("章节目标必须同时提供 target_id 和 document。");
        }
        if (longEntityKindForId(params.target_id) !== "chapter_card") {
          throw new Error("target_id 必须是当前 LOVE 长篇中可识别的章卡 ID。");
        }
        if (params.document !== "body" && params.document !== "card") {
          throw new Error("章节审核目标的 document 只能是 body 或 card。");
        }
        const index = await ctx.loadIndex(signal);
        const resolved = resolveLongTarget(index, {
          id: params.target_id,
          document: params.document
        });
        if (
          resolved.addressing !== "document" ||
          resolved.kind !== "chapter_card"
        ) {
          throw new Error("无法从当前长篇索引解析该章卡审核目标。");
        }
        if (resolved.file.path.length > 500) {
          throw new Error("当前章卡文件路径过长，无法安全传给审核打包器。");
        }
        target = resolved.file.path;
        scope = `${scope} — 目标来自已注册章卡 ${params.target_id}/${params.document}`;
        if (scope.length > 2000) {
          throw new Error("scope 文本过长，无法附加已注册章卡来源标签。");
        }
      }
      const command = LongPrepareCodexReviewCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.prepareCodexReview",
          {
            bookId: LOVE_BOOK_ID,
            scope,
            ...(params.purpose ? { purpose: params.purpose } : {}),
            ...(params.chapter ? { chapter: params.chapter } : {}),
            ...(params.volume ? { volume: params.volume } : {}),
            ...(target ? { target } : {})
          },
          {
            id: `codex-review-${ctx.input.runId}`,
            context: {
              sessionId: ctx.input.sessionId,
              runId: ctx.input.runId,
              resourceId: LOVE_BOOK_ID
            }
          }
        )
      );
      const payload = requireAccepted(
        await requireExecutor(ctx.input.executor)(command, signal)
      );
      if (params.purpose === "draft_handoff") {
        return textResult(
          `写作接续交接已生成；请向作者提供结果中的 promptPath。资料包不代表已生成正文；作者将完整提示词发送给 Codex 后才执行指定章写作。\n${JSON.stringify(payload, null, 2)}`
        );
      }
      return textResult(
        `${handoffStatus(payload)}\n\n这是独立资料副本，不代表作者已确认其中内容为正典。\n\n打包结果：${JSON.stringify(payload, null, 2)}`
      );
    }
  });
}
