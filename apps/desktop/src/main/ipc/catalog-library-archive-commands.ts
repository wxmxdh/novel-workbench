import {
  CatalogSnapshotSchema,
  ExportLibraryMarkdownZipInputSchema,
  ExportLibraryMarkdownZipResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  buildLibraryMarkdownZip,
  writeLibraryMarkdownZip
} from "../library-markdown-archive";
import { safeErrorDetails } from "./errors";
import type { UtilitySupervisor } from "../supervisor";

export async function handleCatalogLibraryArchiveCommands(
  context: {
    supervisor: UtilitySupervisor;
    dialog: Pick<Electron.Dialog, "showSaveDialog">;
    getMainWindow: () => Electron.BrowserWindow;
  },
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type !== "catalog.exportLibraryMarkdownZip") return undefined;
  try {
    const input = ExportLibraryMarkdownZipInputSchema.parse(command.payload);
    const snapshotResult = await context.supervisor.requestCommand(
      "core",
      createEnvelope(
        "catalog.snapshot",
        {},
        {
          id: `${command.id}_snapshot`,
          context: command.context
        }
      ),
      0
    );
    if (snapshotResult.status === "rejected") return snapshotResult;
    const archive = buildLibraryMarkdownZip(
      CatalogSnapshotSchema.parse(snapshotResult.payload),
      input
    );
    const window = context.getMainWindow();
    const selection = window
      ? await context.dialog.showSaveDialog(window, {
          title: "导出 Markdown 压缩包",
          defaultPath: archive.fileName,
          filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }]
        })
      : await context.dialog.showSaveDialog({
          title: "导出 Markdown 压缩包",
          defaultPath: archive.fileName,
          filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }]
        });
    if (selection.canceled || !selection.filePath) {
      return {
        status: "accepted",
        requestId: command.id,
        payload: { canceled: true, exportedCount: 0 }
      };
    }
    await writeLibraryMarkdownZip(selection.filePath, archive.entries);
    return {
      status: "accepted",
      requestId: command.id,
      payload: ExportLibraryMarkdownZipResultSchema.parse({
        canceled: false,
        exportedCount: archive.entries.length
      })
    };
  } catch (error: unknown) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "catalog.export_library_markdown_zip_failed",
        message: error instanceof Error ? error.message : "导出 ZIP 失败。",
        details: safeErrorDetails(error)
      }
    };
  }
}
