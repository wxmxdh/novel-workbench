import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  LongSourceFolderPreviewSchema,
  LongConfirmSourceFolderResultSchema,
  LongQuerySourceFolderResultSchema,
  LongWorkspaceIndexResultSchema,
  type CommandEnvelope,
  type CommandResult,
  type LongSourceFolderPreview
} from "@deepwrite/contracts";
import type { UtilitySupervisor } from "../supervisor";
import {
  listSourceFolder,
  readSourceFolderFile
} from "../../utilities/source-folder-reader";

const previews = new Map<
  string,
  { owner: number; preview: LongSourceFolderPreview; busy: boolean }
>();
export function clearSourceFolderPreviews(owner: number) {
  for (const [id, item] of previews)
    if (item.owner === owner) previews.delete(id);
}
export async function handleSourceFolderCommands(
  ctx: {
    owner: number;
    window: BrowserWindow | null;
    supervisor: Pick<UtilitySupervisor, "requestCommand">;
  },
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    ![
      "long.chooseSourceFolder",
      "long.confirmSourceFolder",
      "long.querySourceFolder",
      "long.disconnectSourceFolder"
    ].includes(command.type)
  )
    return;
  const core = async (type: CommandEnvelope["type"], payload: unknown) => {
    const result = await ctx.supervisor.requestCommand(
      "core",
      CommandEnvelopeSchema.parse(
        createEnvelope(type, payload, {
          id: randomUUID(),
          context: command.context
        })
      ),
      0
    );
    if (result.status === "rejected") throw new Error(result.error.message);
    return result.payload;
  };
  let held:
    | { owner: number; preview: LongSourceFolderPreview; busy: boolean }
    | undefined;
  try {
    let payload: unknown;
    if (command.type === "long.chooseSourceFolder") {
      await core("long.getWorkspaceIndex", { bookId: command.payload.bookId });
      const suggestedPath = command.payload.suggestedPath;
      const options = {
        title: "选择本书资料文件夹",
        ...(suggestedPath && isAbsolute(suggestedPath)
          ? {
              defaultPath: /\.(?:md|markdown|txt)$/iu.test(suggestedPath)
                ? dirname(suggestedPath)
                : suggestedPath
            }
          : {}),
        properties: ["openDirectory"] as Array<"openDirectory">
      };
      const picked = ctx.window
        ? await dialog.showOpenDialog(ctx.window, options)
        : await dialog.showOpenDialog(options);
      if (picked.canceled || !picked.filePaths[0]) payload = null;
      else {
        for (const [id, item] of previews)
          if (Date.parse(item.preview.expiresAt) < Date.now())
            previews.delete(id);
        if (previews.size >= 100)
          throw new Error("资料预览过多，请关闭旧预览后重试。");
        const rootPath = picked.filePaths[0];
        const preview = LongSourceFolderPreviewSchema.parse({
          ...(await listSourceFolder(rootPath)),
          rootPath,
          title: basename(rootPath),
          bookId: command.payload.bookId,
          previewId: randomUUID(),
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
        });
        previews.set(preview.previewId, {
          owner: ctx.owner,
          preview,
          busy: false
        });
        payload = preview;
      }
    } else if (command.type === "long.confirmSourceFolder") {
      const input = command.payload;
      const stored = previews.get(input.previewId);
      if (
        !stored ||
        stored.owner !== ctx.owner ||
        stored.preview.bookId !== input.bookId ||
        stored.busy ||
        Date.parse(stored.preview.expiresAt) < Date.now()
      )
        throw new Error("资料预览已过期或正在保存，请重新选择。");
      held = stored;
      stored.busy = true;
      const ids = new Set(input.fileIds);
      if (ids.size !== input.fileIds.length)
        throw new Error("重复的资料选择。");
      const selected = stored.preview.files.filter((file) => ids.has(file.id));
      if (selected.length !== ids.size)
        throw new Error("资料不属于本次选择的文件夹。");
      // Verify every selected source before any write. Exact text copies remain immutable.
      for (const file of selected)
        if (
          (
            await readSourceFolderFile(
              stored.preview.rootPath,
              file.relativePath
            )
          ).sha256 !== file.sha256
        )
          throw new Error(`资料已变化，请重新预览：${file.relativePath}`);
      const result: {
        bookId: string;
        mode: "copy" | "connect";
        imported: number;
        duplicates: number;
        failures: Array<{ relativePath: string; reason: string }>;
        folder?: unknown;
      } = {
        bookId: input.bookId,
        mode: input.mode,
        imported: 0,
        duplicates: 0,
        failures: []
      };
      if (input.mode === "connect") {
        const connected = (await core("long.connectSourceFolderAtPath", {
          bookId: input.bookId,
          rootPath: stored.preview.rootPath,
          title: stored.preview.title,
          purpose: input.purpose,
          authority: input.authority,
          allowedFileIds: input.fileIds
        })) as { folder: unknown };
        result.folder = connected.folder;
      } else {
        for (const file of selected) {
          try {
            const index = LongWorkspaceIndexResultSchema.parse(
              await core("long.getWorkspaceIndex", { bookId: input.bookId })
            ).workspaceIndex;
            if (
              index.importedSources.some(
                (source) => source.sourceSha256 === file.sha256
              )
            ) {
              result.duplicates++;
              continue;
            }
            const source = await readSourceFolderFile(
              stored.preview.rootPath,
              file.relativePath
            );
            if (source.sha256 !== file.sha256)
              throw new Error("预览后资料已变化");
            await core("long.importSource", {
              bookId: input.bookId,
              expectedIndexUpdatedAt: index.updatedAt,
              title: basename(file.relativePath),
              sourceName: file.relativePath,
              sourcePath: `${stored.preview.rootPath}/${file.relativePath}`,
              content: source.content,
              purpose: input.purpose,
              authority: input.authority
            });
            result.imported++;
          } catch (error) {
            result.failures.push({
              relativePath: file.relativePath,
              reason: error instanceof Error ? error.message : "保存失败"
            });
          }
        }
      }
      payload = LongConfirmSourceFolderResultSchema.parse(result);
      if (!result.failures.length) previews.delete(input.previewId);
    } else if (
      command.type === "long.querySourceFolder" ||
      command.type === "long.disconnectSourceFolder"
    ) {
      payload = LongQuerySourceFolderResultSchema.parse(
        await core(command.type, command.payload)
      );
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "long.source_folder_failed",
        message: error instanceof Error ? error.message : "资料文件夹操作失败"
      }
    };
  } finally {
    if (held) held.busy = false;
  }
}
