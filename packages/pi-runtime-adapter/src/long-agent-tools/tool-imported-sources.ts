import {
  createEnvelope,
  LongSourceFolderCommandSchemas,
  LongQuerySourceFolderResultSchema
} from "@deepwrite/contracts";
import { createHash } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, textResult } from "./shared";
import { strictObject } from "./schemas";
import type { LongToolContext } from "./context";

/** Read-only access to explicitly imported source copies, separate from fixed novel stages. */
export function buildQueryImportedSourcesTool(ctx: LongToolContext): AgentTool {
  return defineTool({
    name: "query_imported_sources",
    label: "查看已接入资料",
    description:
      "查询作者明确接入本书的原文资料和连接的只读文件夹。用户让你查本书资料或已连接文件时，先实际调用本工具列出来源，再按需读取，不要直接声称不能读本地文件。不给参数先列来源；source_id列目录，query搜索，connected_file_id读取当前原文，外部原件不变。不给 file_id 时只列标题、来源、用途、身份和文件引用；给 file_id 时读取该资料全文并核对内容。未接入的路径可以通过界面顶部「资料与导入」或输入框左下角「+ → 连接只读文件夹」登记；不得编造不存在的「导入资料」按钮。foundation/candidate/reference均不代表正典，不要自动当作已确认事实。",
    parameters: strictObject({
      file_id: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      source_id: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      connected_file_id: Type.Optional(
        Type.String({ minLength: 1, maxLength: 256 })
      ),
      query: Type.Optional(Type.String({ maxLength: 200 }))
    }),
    execute: async (_id, params, signal) => {
      const index = await ctx.loadIndex(signal);
      const sources = index.importedSources ?? [];
      if (params.source_id) {
        const command = LongSourceFolderCommandSchemas[3].parse(
          createEnvelope(
            "long.querySourceFolder",
            {
              bookId: index.bookId,
              sourceId: params.source_id,
              ...(params.connected_file_id
                ? { fileId: params.connected_file_id }
                : {}),
              ...(params.query ? { query: params.query } : {})
            },
            {
              id: `source-folder-${ctx.input.runId}-${_id}`,
              context: {
                sessionId: ctx.input.sessionId,
                runId: ctx.input.runId,
                resourceId: index.bookId
              }
            }
          )
        );
        const result = LongQuerySourceFolderResultSchema.parse(
          await ctx.execute(command, signal)
        );
        if (result.bookId !== index.bookId)
          throw new Error("资料来源返回了其他书籍。");
        return textResult(
          JSON.stringify(
            {
              ...result,
              canon_notice:
                "外部原件只读，参考资料不自动成为本书事实；document才是实际读取的全文。"
            },
            null,
            2
          )
        );
      }
      if (params.connected_file_id || params.query)
        throw new Error("检索只读文件夹需要先列出来源并指定source_id。");
      if (!params.file_id) {
        return textResult(
          JSON.stringify(
            {
              book_id: index.bookId,
              count: sources.length,
              connected_source_folders: (index.sourceFolders ?? []).map(
                (folder) => ({
                  id: folder.id,
                  title: folder.title,
                  purpose: folder.purpose,
                  authority: folder.authority,
                  connected_at: folder.connectedAt,
                  notice:
                    "使用source_id列出文件，再用connected_file_id读取实际原文；query检索名称及内容"
                })
              ),
              imported_sources: sources.map((source) => ({
                id: source.id,
                title: source.title,
                source_name: source.sourceName,
                source_declaration: source.sourcePath ?? null,
                purpose: source.purpose,
                purpose_note: source.purposeNote ?? null,
                authority: source.authority,
                source_sha256: source.sourceSha256,
                imported_at: source.importedAt,
                file_id: source.file.id,
                file_path: source.file.path
              })),
              canon_notice: "接入状态不等于正典确认。"
            },
            null,
            2
          )
        );
      }
      const source = sources.find((item) => item.file.id === params.file_id);
      if (!source) throw new Error("指定 file_id 不属于当前书的已接入资料。");
      const document = await ctx.readWholeDocument(source.file, signal);
      const actualSha256 = createHash("sha256")
        .update(document.content, "utf8")
        .digest("hex");
      if (actualSha256 !== source.sourceSha256) {
        throw new Error(
          "资料正文 SHA-256 与接入索引不一致；停止引用并请作者检查文件。"
        );
      }
      return textResult(
        [
          `已接入资料：${source.title}`,
          `来源名称：${source.sourceName}`,
          `来源声明：${source.sourcePath ?? "未提供"}`,
          `用途：${source.purpose}`,
          ...(source.purposeNote
            ? [`作者用途说明：${source.purposeNote}`]
            : []),
          `身份：${source.authority}（不是正典确认）`,
          `已核对 SHA-256：${actualSha256}`,
          `项目相对路径：${document.file.path}`,
          "",
          document.content
        ].join("\n")
      );
    }
  });
}
