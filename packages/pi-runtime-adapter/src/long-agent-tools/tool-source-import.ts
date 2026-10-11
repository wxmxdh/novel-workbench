import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, textResult } from "./shared";
import { strictObject } from "./schemas";
import type { LongToolContext } from "./context";

/** A read-only structured hand-off to the author; it never writes project files. */
export function buildSourceImportProposalTool(ctx: LongToolContext): AgentTool {
  return defineTool({
    name: "propose_long_source_import",
    label: "整理资料接入建议",
    description:
      "仅在作者明确要求导入/接入本轮所选资料，或保存本次讨论为候选大纲时调用。此工具只生成可核对的建议，绝不保存文件或确认正典。附件来源名必须与作者本轮上传的文件名完全一致；讨论来源名固定为‘本次讨论’，并提供候选正文。说明建议用途、身份、冲突和未决问题。",
    parameters: strictObject({
      source_name: Type.String({ minLength: 1, maxLength: 240 }),
      title: Type.String({ minLength: 1, maxLength: 240 }),
      purpose: StringEnum([
        "foundation",
        "character",
        "outline",
        "discussion",
        "reference",
        "other"
      ] as const),
      authority: StringEnum(["candidate", "undecided", "reference"] as const),
      summary: Type.String({ maxLength: 4_000 }),
      conflicts: Type.Array(Type.String({ maxLength: 1_000 }), {
        maxItems: 30
      }),
      unresolved_questions: Type.Array(Type.String({ maxLength: 1_000 }), {
        maxItems: 30
      }),
      candidate_content: Type.Optional(Type.String({ maxLength: 100_000 }))
    }),
    execute: async (_id, params) => {
      if (
        params.source_name === "本次讨论" &&
        (!params.candidate_content ||
          params.purpose !== "outline" ||
          params.authority !== "candidate")
      ) {
        return textResult(
          "候选大纲建议无效：‘本次讨论’必须提供候选正文，且用途为 outline、身份为 candidate。尚未保存任何内容。"
        );
      }
      if (
        params.source_name !== "本次讨论" &&
        params.candidate_content !== undefined
      ) {
        return textResult(
          "附件导入建议不能替换附件原文。请移除 candidate_content，保存时将使用作者选定的原始附件文本。"
        );
      }
      return textResult(
        JSON.stringify({
          type: "long_source_import_proposal",
          book_id: ctx.workspace.bookId,
          source_name: params.source_name,
          title: params.title,
          purpose: params.purpose,
          authority: params.authority,
          saved: false,
          author_confirmation_required: true,
          canon_status: "not_confirmed"
        })
      );
    }
  });
}
