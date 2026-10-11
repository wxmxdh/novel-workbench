import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  LongApplyLoveLocalRevisionCommandEnvelopeSchema,
  LongApplyLoveLocalRevisionResultSchema,
  LongPrepareLoveLocalRevisionCommandEnvelopeSchema,
  LongPrepareLoveLocalRevisionResultSchema,
  createEnvelope,
  type AgentRuntimeRef,
  type CommandResult,
  type LoveLocalRevisionPatch,
  type ComparisonDraftWriterContext
} from "@deepwrite/contracts";
import { randomUUID } from "node:crypto";
import { piStrictToolSampling } from "../pi-tool-schema";
import { textResult } from "./shared";

type AuthorEvidence = {
  path: string;
  sha256: string;
  quote: string;
};

export interface LoveLocalRevisionExecutor {
  (
    command:
      | import("@deepwrite/contracts").LongPrepareLoveLocalRevisionCommandEnvelope
      | import("@deepwrite/contracts").LongApplyLoveLocalRevisionCommandEnvelope,
    signal?: AbortSignal
  ): Promise<CommandResult>;
}

export function buildLoveLocalRevisionTools(input: {
  context: ComparisonDraftWriterContext;
  runtime: AgentRuntimeRef;
  sessionId: string;
  runId: string;
  executor: LoveLocalRevisionExecutor;
  onContextCompacted?: (listener: () => void) => void;
}): AgentTool[] {
  let revisionPreparationId: string | undefined;
  let sourcePath: string | undefined;
  let sourceSha256: string | undefined;
  let authorRevisionEvidence: AuthorEvidence | undefined;
  input.onContextCompacted?.(() => {
    revisionPreparationId = undefined;
    sourcePath = undefined;
    sourceSha256 = undefined;
    authorRevisionEvidence = undefined;
  });

  const prepareParameters = Type.Object({
    comparison_preparation_id: Type.String({ minLength: 16, maxLength: 128 }),
    source_path: Type.String({ minLength: 1, maxLength: 1_000 }),
    source_sha256: Type.String({ pattern: "^[a-f0-9]{64}$" })
  });
  const prepare: AgentTool<typeof prepareParameters> = {
    name: "prepare_love_local_revision",
    label: "读取并绑定待修订稿",
    description:
      "先成功调用 prepare_comparison_draft，再将其返回的 preparationId、待修订稿项目相对路径和当前 SHA-256 传入。Core 会重新读取并绑定稿件全文；稿件版本不符或路径不属于 LOVE 当前章稿件时停止。此步骤只读取，不修改文件。",
    parameters: prepareParameters,
    ...piStrictToolSampling(prepareParameters),
    executionMode: "sequential",
    execute: async (_toolCallId, args, signal) => {
      revisionPreparationId = undefined;
      sourcePath = undefined;
      sourceSha256 = undefined;
      authorRevisionEvidence = undefined;
      const command = LongPrepareLoveLocalRevisionCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.prepareLoveLocalRevision",
          {
            bookId: input.context.bookId,
            authorizationId: input.context.authorizationId,
            comparisonPreparationId: args.comparison_preparation_id,
            sourcePath: args.source_path,
            sourceSha256: args.source_sha256
          },
          {
            id: `love-revision-prepare-${randomUUID()}`,
            context: {
              sessionId: input.sessionId,
              runId: input.runId,
              resourceId: input.context.bookId
            }
          }
        )
      );
      const response = await input.executor(command, signal);
      if (response.status !== "accepted")
        throw new Error(response.error?.message ?? "待修订稿准备失败。");
      if (response.payload === undefined)
        throw new Error("Core 未返回待修订稿绑定结果。");
      const result = LongPrepareLoveLocalRevisionResultSchema.parse(
        response.payload
      );
      if (
        result.bookId !== input.context.bookId ||
        result.comparisonPreparationId !== args.comparison_preparation_id ||
        result.sourcePath !== args.source_path ||
        result.sourceSha256 !== args.source_sha256
      )
        throw new Error("Core 返回的待修订稿与本轮请求不一致。");
      revisionPreparationId = result.revisionPreparationId;
      sourcePath = result.sourcePath;
      sourceSha256 = result.sourceSha256;
      authorRevisionEvidence = result.authorRevisionEvidence;
      return textResult(
        `已读取并绑定待修订稿；正文与批注尚未修改，已创建本轮 V1 Context、Receipt 和 preflight。\n项目：LOVE\n章节：第${String(result.chapter).padStart(3, "0")}章\n底稿：${result.sourcePath}\n底稿 SHA-256：${result.sourceSha256}\n底稿型号：${result.sourceModel}\n\n【本轮 V1 prepare/preflight 实际读取内容】\n${result.readContent}\n\n每条修改必须给出底稿中的准确原句、新句和具体理由。只返回局部替换，不重写全文。`
      );
    }
  };

  const applyParameters = Type.Object({
    action: StringEnum(["preview", "deliver"] as const),
    patches: Type.Array(
      Type.Object({
        oldText: Type.String({ minLength: 1, maxLength: 20_000 }),
        newText: Type.String({ maxLength: 20_000 }),
        reason: Type.String({ minLength: 1, maxLength: 2_000 }),
        occurrence: Type.Optional(
          Type.Integer({ minimum: 1, maximum: 100_000 })
        )
      }),
      { minItems: 1, maxItems: 100 }
    )
  });
  const apply: AgentTool<typeof applyParameters> = {
    name: "apply_love_local_revision",
    label: "预览或另存局部修订",
    description:
      "对已绑定的底稿应用精确原句替换。preview 只返回修改前后与整稿预览、不写文件；deliver 只有本轮 Main 已识别到作者明确要求落盘修订时才可用，Core 会再次核对原稿 SHA-256 并经公共写作协议 V1 prepare/preflight/deliver-draft 另存新稿。newText 为空表示删除选中的原文范围，仍须本轮作者明确授权局部修订。不得删除稿件文件或批注，也不得把模型意见当成作者授权。",
    parameters: applyParameters,
    ...piStrictToolSampling(applyParameters),
    executionMode: "sequential",
    execute: async (_toolCallId, args, signal) => {
      if (!revisionPreparationId || !sourcePath || !sourceSha256)
        throw new Error(
          "请先调用 prepare_love_local_revision 读取并绑定底稿。"
        );
      if (args.action === "deliver" && !authorRevisionEvidence)
        throw new Error("当前准备记录没有本轮作者修订授权；只能预览。");
      const patches = args.patches as LoveLocalRevisionPatch[];
      const command = LongApplyLoveLocalRevisionCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.applyLoveLocalRevision",
          {
            bookId: input.context.bookId,
            authorizationId: input.context.authorizationId,
            revisionPreparationId,
            patches,
            action: args.action,
            ...(args.action === "deliver" && authorRevisionEvidence
              ? { authorRevisionEvidence }
              : {}),
            ...(args.action === "deliver" ? { runtime: input.runtime } : {})
          },
          {
            id: `love-revision-apply-${randomUUID()}`,
            context: {
              sessionId: input.sessionId,
              runId: input.runId,
              resourceId: input.context.bookId
            }
          }
        )
      );
      const response = await input.executor(command, signal);
      if (response.status !== "accepted")
        throw new Error(response.error?.message ?? "局部修订操作失败。");
      if (response.payload === undefined)
        throw new Error("Core 未返回局部修订结果。");
      const result = LongApplyLoveLocalRevisionResultSchema.parse(
        response.payload
      );
      if (
        result.bookId !== input.context.bookId ||
        result.revisionPreparationId !== revisionPreparationId ||
        result.sourcePath !== sourcePath ||
        result.sourceSha256 !== sourceSha256 ||
        result.action !== args.action
      )
        throw new Error("Core 返回的局部修订与当前绑定底稿不一致。");
      if (args.action === "preview")
        return textResult(
          `局部修订预览完成；没有写入文件。底稿：${result.sourcePath}\n\n${result.patches
            .map(
              (patch, index) =>
                `修改 ${index + 1}\n原句：${patch.oldText}\n新句：${patch.newText}\n理由：${patch.reason}`
            )
            .join("\n\n")}\n\n【整稿预览】\n${result.previewContent}`
        );
      return textResult(
        `局部修订已另存为待审阅新稿：${result.path}\n底稿：${result.sourcePath}\n底稿 SHA-256：${result.sourceSha256}\n新稿 SHA-256：${result.outputSha256}\n模型：${result.model}\n交付记录：${result.deliveryRecord}\n原稿与批注保持不变；未登记正典。`
      );
    }
  };
  return [prepare, apply];
}
