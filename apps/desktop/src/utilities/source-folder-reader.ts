import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SourceFolderListingSchema } from "@deepwrite/contracts";
import { readNoFollowFile } from "./long-project-store/io";

const EXCLUDED = new Set([
  "node_modules",
  ".git",
  ".codex",
  ".aws",
  "dist",
  "release",
  "backup",
  "backups",
  "备份",
  "归档"
]);
const EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
export const SOURCE_FOLDER_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const SOURCE_FOLDER_QUERY_MAX_BYTES = 32 * 1024 * 1024;

export function sourceFolderFileId(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

export async function resolveSourceFolder(root: string): Promise<string> {
  const absolute = resolve(root);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("资料目录必须是真实文件夹，不能是目录联接。");
  const canonical = await realpath(absolute);
  if (!samePath(absolute, canonical))
    throw new Error("资料目录不能通过链接接入。");
  return canonical;
}

export async function readSourceFolderFile(
  root: string,
  relativePath: string,
  maxBytes = SOURCE_FOLDER_FILE_MAX_BYTES
) {
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath
      .split(/[\\/]/u)
      .some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("资料路径超出已连接文件夹。");
  }
  const canonical = await resolveSourceFolder(root);
  const parts = relativePath.split(/[\\/]/u);
  let filePath = canonical;
  for (const part of parts) {
    filePath = join(filePath, part);
    const info = await lstat(filePath);
    if (info.isSymbolicLink()) throw new Error("不读取符号链接或目录联接。");
    if (part !== parts.at(-1) && !info.isDirectory())
      throw new Error("资料路径包含非目录节点。");
  }
  const actual = await realpath(filePath);
  const within = relative(canonical, actual);
  if (
    !within ||
    within.startsWith(`..${sep}`) ||
    within === ".." ||
    isAbsolute(within)
  )
    throw new Error("资料路径超出已连接文件夹。");
  if (!EXTENSIONS.has(extname(actual).toLowerCase()))
    throw new Error("仅支持不超过2MiB的MD/TXT资料。");
  const { bytes } = await readNoFollowFile(
    actual,
    Math.min(SOURCE_FOLDER_FILE_MAX_BYTES, maxBytes),
    "资料文件",
    canonical
  );
  // Recheck the whole path after opening/reading. The open handle itself uses
  // O_NOFOLLOW and inode checks; this catches replaced directory components.
  let checked = canonical;
  for (const part of parts) {
    checked = join(checked, part);
    const info = await lstat(checked);
    if (info.isSymbolicLink())
      throw new Error("资料路径在读取期间变成了链接。");
  }
  const finalPath = await realpath(filePath);
  const finalWithin = relative(canonical, finalPath);
  if (
    !finalWithin ||
    finalWithin.startsWith(`..${sep}`) ||
    finalWithin === ".." ||
    isAbsolute(finalWithin)
  )
    throw new Error("资料路径在读取期间越出已连接文件夹。");
  const content = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true
  }).decode(bytes);
  if (!content.trim() || content.includes("\0"))
    throw new Error("资料为空或含二进制内容。");
  return {
    content,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

export async function readVerifiedSourceFolderFile(
  root: string,
  file: { relativePath: string; sha256: string; bytes: number },
  maxBytes = SOURCE_FOLDER_FILE_MAX_BYTES
) {
  const result = await readSourceFolderFile(root, file.relativePath, maxBytes);
  if (result.sha256 !== file.sha256)
    throw new Error(
      `资料在本次读取期间已变化，请重新查询：${file.relativePath}`
    );
  return result;
}

interface ScanOptions {
  maxTotalBytes?: number;
  onlyFileIds?: ReadonlySet<string>;
}

export async function scanSourceFolder(
  root: string,
  options: ScanOptions = {}
) {
  const canonical = await resolveSourceFolder(root);
  const maxTotalBytes = Math.min(
    options.maxTotalBytes ?? SOURCE_FOLDER_QUERY_MAX_BYTES,
    SOURCE_FOLDER_QUERY_MAX_BYTES
  );
  const files: Array<{
    id: string;
    relativePath: string;
    bytes: number;
    sha256: string;
  }> = [];
  const skipped: Array<{ relativePath: string; reason: string }> = [];
  let visited = 0;
  let scannedBytes = 0;
  let limited = false;
  let stop = false;
  const skip = (path: string, reason: string) => {
    if (skipped.length < 1000) skipped.push({ relativePath: path, reason });
  };

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 12 || visited >= 2000 || files.length >= 500) {
      limited = true;
      return;
    }
    const directoryInfo = await lstat(directory);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory())
      throw new Error("资料目录在扫描期间发生变化。");
    const resolvedDirectory = await realpath(directory);
    const relativeDirectory = relative(canonical, resolvedDirectory);
    if (
      relativeDirectory &&
      (relativeDirectory.startsWith(`..${sep}`) ||
        relativeDirectory === ".." ||
        isAbsolute(relativeDirectory))
    )
      throw new Error("资料目录在扫描期间越出已连接文件夹。");
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      if (stop) return;
      if (++visited > 2000 || files.length >= 500) {
        limited = true;
        return;
      }
      const filePath = join(directory, entry.name);
      const path = relative(canonical, filePath).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        skip(path, "链接不读取");
        continue;
      }
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          EXCLUDED.has(entry.name.toLowerCase()) ||
          /(?:^|[_-])(?:备份|backup)(?:[_-]|$)/iu.test(entry.name)
        )
          skip(path, "排除系统、依赖或备份目录");
        else await walk(filePath, depth + 1);
      } else if (
        !EXTENSIONS.has(extname(entry.name).toLowerCase()) ||
        /(?:^\.|credential|secret|api[_-]?key)/iu.test(entry.name)
      ) {
        skip(path, "不支持或不适合作为资料的文件");
      } else {
        const id = sourceFolderFileId(path);
        if (options.onlyFileIds && !options.onlyFileIds.has(id)) continue;
        const remaining = maxTotalBytes - scannedBytes;
        try {
          if (remaining <= 0) throw new SourceFolderBudgetExceededError();
          const result = await readSourceFolderFile(canonical, path, remaining);
          scannedBytes += result.bytes;
          files.push({
            id,
            relativePath: path,
            bytes: result.bytes,
            sha256: result.sha256
          });
        } catch (error) {
          if (
            error instanceof SourceFolderBudgetExceededError ||
            (remaining < SOURCE_FOLDER_FILE_MAX_BYTES &&
              error instanceof Error &&
              error.message.includes("超过大小限制"))
          ) {
            limited = true;
            skip(
              path,
              `本次扫描达到${Math.floor(maxTotalBytes / (1024 * 1024))}MiB读取上限`
            );
            stop = true;
          } else
            skip(path, error instanceof Error ? error.message : "读取失败");
        }
      }
    }
    const afterInfo = await lstat(directory);
    if (
      afterInfo.isSymbolicLink() ||
      !afterInfo.isDirectory() ||
      !samePath(await realpath(directory), resolvedDirectory)
    )
      throw new Error("资料目录在扫描期间发生变化。");
  }

  await walk(canonical, 0);
  return {
    listing: SourceFolderListingSchema.parse({ files, skipped, limited }),
    scannedBytes
  };
}

export async function listSourceFolder(root: string) {
  return (await scanSourceFolder(root)).listing;
}

class SourceFolderBudgetExceededError extends Error {}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => resolve(value).replace(/[\\/]+$/u, "");
  const leftNormalized = normalize(left);
  const rightNormalized = normalize(right);
  return process.platform === "win32"
    ? leftNormalized.toLocaleLowerCase("en-US") ===
        rightNormalized.toLocaleLowerCase("en-US")
    : leftNormalized === rightNormalized;
}
