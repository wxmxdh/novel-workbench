import {
  CommandEnvelopeSchema,
  LongImportSourceResultSchema,
  LongWorkspaceIndexResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { SourceImportPreviewRegistry } from "../source-import-preview-registry";
import type { UtilitySupervisor } from "../supervisor";

export async function handleSourceImportCommands(
  context: {
    supervisor: Pick<UtilitySupervisor, "requestCommand">;
    previews: SourceImportPreviewRegistry;
    owner: number;
  },
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    command.type !== "long.stageSourceImport" &&
    command.type !== "long.confirmSourceImport"
  )
    return;
  let acquiredPreview: string | undefined;
  try {
    if (command.type === "long.stageSourceImport") {
      const query = CommandEnvelopeSchema.parse(
        createEnvelope(
          "long.getWorkspaceIndex",
          {
            bookId: command.payload.bookId
          },
          { id: `${command.id}:source-index` }
        )
      );
      const result = await context.supervisor.requestCommand("core", query, 0);
      if (result.status === "rejected")
        return { ...result, requestId: command.id };
      const current = LongWorkspaceIndexResultSchema.parse(result.payload);
      if (
        current.workspaceIndex.updatedAt !==
        command.payload.expectedIndexUpdatedAt
      ) {
        throw new Error("本书资料已变化，请刷新后重新准备导入。");
      }
      return {
        status: "accepted",
        requestId: command.id,
        payload: context.previews.stage(context.owner, command.payload)
      };
    }
    const input = context.previews.acquire(
      command.payload.previewId,
      context.owner,
      command.payload.bookId
    );
    acquiredPreview = command.payload.previewId;
    const internal = CommandEnvelopeSchema.parse(
      createEnvelope("long.importSource", input, {
        id: command.id,
        context: command.context
      })
    );
    const result = await context.supervisor.requestCommand("core", internal, 0);
    context.previews.finish(acquiredPreview, result.status === "accepted");
    acquiredPreview = undefined;
    if (result.status === "rejected") return result;
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongImportSourceResultSchema.parse(result.payload)
    };
  } catch (error: unknown) {
    if (acquiredPreview) context.previews.finish(acquiredPreview, false);
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "long.source_import_failed",
        message:
          error instanceof Error ? error.message : "资料导入失败，请重新准备。"
      }
    };
  }
}
