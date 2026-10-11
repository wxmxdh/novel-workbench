import { basename } from "node:path";
import { createId } from "@deepwrite/shared";
import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongSourceFolderSchema,
  LongWorkspaceIndexSnapshotSchema,
  type LongSourceFolder,
  type LongQuerySourceFolderInput
} from "@deepwrite/contracts";
import {
  commitLongProjectTransaction,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import type { LongProjectStoreContext } from "./store-context";
import { MANIFEST_PATH, MAX_LEDGER_RECORD_BYTES } from "./types";
import {
  readVerifiedSourceFolderFile,
  resolveSourceFolder,
  scanSourceFolder,
  SOURCE_FOLDER_QUERY_MAX_BYTES
} from "../source-folder-reader";

const SOURCE_QUERY_LIST_BUDGET = SOURCE_FOLDER_QUERY_MAX_BYTES / 2;

export async function updateSourceFolder(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: {
    bookId: string;
    folder?: Omit<LongSourceFolder, "id" | "connectedAt">;
    disconnectId?: string;
  }
) {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    if (loaded.book.id !== input.bookId)
      throw new Error("资料连接所属书籍不一致。");
    let folders = [...loaded.index.sourceFolders];
    let folder: LongSourceFolder | undefined;
    if (input.folder) {
      const rootPath = await resolveSourceFolder(input.folder.rootPath);
      const listing = (
        await scanSourceFolder(rootPath, {
          onlyFileIds: new Set(input.folder.allowedFileIds)
        })
      ).listing;
      const allowed = new Set(listing.files.map((file) => file.id));
      if (input.folder.allowedFileIds.some((id) => !allowed.has(id))) {
        throw new Error("所选资料已变化或超出本次扫描上限，请重新预览文件夹。");
      }
      folder = LongSourceFolderSchema.parse({
        ...input.folder,
        rootPath,
        title: input.folder.title || basename(rootPath),
        id: createId("folder"),
        connectedAt: ctx.timestamp()
      });
      if (folders.some((item) => samePath(item.rootPath, rootPath))) {
        throw new Error("此文件夹已连接，可先断开后重新选择范围。");
      }
      folders.push(folder);
    } else {
      if (!folders.some((item) => item.id === input.disconnectId))
        throw new Error("资料连接不存在。");
      folders = folders.filter((item) => item.id !== input.disconnectId);
    }
    const updatedAt = new Date(
      Math.max(
        Date.parse(ctx.timestamp()),
        Date.parse(loaded.index.updatedAt) + 1
      )
    ).toISOString();
    const index = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      sourceFolders: folders,
      updatedAt
    });
    const manifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt,
      workspaceIndexFile: { ...loaded.manifest.workspaceIndexFile, updatedAt }
    });
    await commitLongProjectTransaction({
      projectRoot: canonical,
      operations: [
        { path: LONG_WORKSPACE_INDEX_PATH, content: serializeJson(index) },
        { path: MANIFEST_PATH, content: serializeJson(manifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    return { bookId: input.bookId, folders, ...(folder ? { folder } : {}) };
  });
}

export async function querySourceFolder(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: LongQuerySourceFolderInput
) {
  const loaded = await loadProject(
    ctx,
    await secureDirectory(projectDirectory, "长篇项目目录")
  );
  if (loaded.book.id !== input.bookId)
    throw new Error("资料连接所属书籍不一致。");
  const folders = loaded.index.sourceFolders;
  if (!input.sourceId) {
    if (input.fileId) throw new Error("读取文件必须指定资料来源。");
    return { bookId: input.bookId, folders };
  }
  const folder = folders.find((item) => item.id === input.sourceId);
  if (!folder) throw new Error("资料来源未连接当前书籍或已断开。");
  const allowed = new Set(folder.allowedFileIds);
  const hasTextQuery = Boolean(input.query?.trim()) && !input.fileId;
  const scanned = await scanSourceFolder(folder.rootPath, {
    onlyFileIds: input.fileId ? new Set([input.fileId]) : allowed,
    maxTotalBytes: hasTextQuery
      ? SOURCE_QUERY_LIST_BUDGET
      : SOURCE_FOLDER_QUERY_MAX_BYTES
  });
  const files = scanned.listing.files;
  if (input.fileId) {
    const file = files.find((item) => item.id === input.fileId);
    if (!file) throw new Error("文件不在作者选择的范围内，或已移走/无法读取。");
    const remaining = SOURCE_FOLDER_QUERY_MAX_BYTES - scanned.scannedBytes;
    if (file.bytes > remaining)
      throw new Error("本次查询达到32MiB读取上限，请重新查询。");
    const result = await readVerifiedSourceFolderFile(
      folder.rootPath,
      file,
      remaining
    );
    return {
      bookId: input.bookId,
      folders: [folder],
      document: {
        fileId: file.id,
        relativePath: file.relativePath,
        sha256: result.sha256,
        content: result.content
      }
    };
  }

  const query = input.query?.trim().toLocaleLowerCase();
  if (!query) {
    return {
      bookId: input.bookId,
      folders: [folder],
      listing: { ...scanned.listing, skipped: [] }
    };
  }

  const matched = [];
  let queryBytes = 0;
  let limited = scanned.listing.limited;
  for (const file of files) {
    if (file.relativePath.toLocaleLowerCase().includes(query)) {
      matched.push(file);
      continue;
    }
    const remaining =
      SOURCE_FOLDER_QUERY_MAX_BYTES - scanned.scannedBytes - queryBytes;
    if (file.bytes > remaining) {
      limited = true;
      continue;
    }
    const result = await readVerifiedSourceFolderFile(
      folder.rootPath,
      file,
      remaining
    );
    queryBytes += result.bytes;
    if (result.content.toLocaleLowerCase().includes(query)) matched.push(file);
  }
  return {
    bookId: input.bookId,
    folders: [folder],
    listing: { ...scanned.listing, files: matched, skipped: [], limited }
  };
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+$/u, "");
  const leftNormalized = normalize(left);
  const rightNormalized = normalize(right);
  return process.platform === "win32"
    ? leftNormalized.toLocaleLowerCase("en-US") ===
        rightNormalized.toLocaleLowerCase("en-US")
    : leftNormalized === rightNormalized;
}
