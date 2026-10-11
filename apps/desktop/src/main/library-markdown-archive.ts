import { basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { createZip } from "../extras/cloud-backup/zip";
import { openLegacyZipArchive } from "../utilities/legacy-zip";
import { CATALOG_PROJECT_MAX_CONTENT_ITEMS } from "@deepwrite/contracts";
import type {
  CatalogSnapshot,
  ExportLibraryMarkdownZipInput
} from "@deepwrite/contracts";

export class LibraryMarkdownArchiveTooLargeError extends Error {}

function safeMarkdownName(value: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/[. ]+$/gu, "")
    .trim();
  return [...(normalized || "未命名条目")].slice(0, 100).join("");
}

export function buildLibraryMarkdownZip(
  snapshot: CatalogSnapshot,
  input: ExportLibraryMarkdownZipInput
): { fileName: string; entries: Array<{ name: string; data: Buffer }> } {
  const libraries =
    input.domain === "material" ? snapshot.materials : snapshot.skills;
  const groups =
    input.domain === "material"
      ? snapshot.materialGroups
      : snapshot.skillGroups;
  const selected =
    input.targetType === "library"
      ? libraries.filter((library) => library.id === input.targetId)
      : (() => {
          const group = groups.find(
            (candidate) => candidate.id === input.targetId
          );
          if (!group) return [];
          const memberIds = new Set(
            Object.values(group.members).filter(Boolean)
          );
          return libraries.filter((library) => memberIds.has(library.id));
        })();
  if (selected.length === 0) throw new Error("找不到要导出的素材库或技能库。");
  const allEntries = selected.flatMap((library) =>
    library.entries.map((entry) => ({
      name: `${safeMarkdownName(library.title)}/${safeMarkdownName(entry.title)}.md`,
      data: Buffer.from(entry.body, "utf8")
    }))
  );
  if (allEntries.length === 0)
    throw new Error("所选库中没有可导出的 Markdown 条目。");
  const names = new Set<string>();
  const entries = allEntries.map((entry) => {
    const collisionKey = entry.name.normalize("NFC").toLocaleLowerCase("en-US");
    if (!names.has(collisionKey)) {
      names.add(collisionKey);
      return entry;
    }
    const separator = entry.name.lastIndexOf("/");
    const directory = entry.name.slice(0, separator + 1);
    const stem = entry.name.slice(separator + 1).replace(/\.md$/u, "");
    for (let index = 2; index < 100_000; index += 1) {
      const name = `${directory}${stem} (${index}).md`;
      const candidateKey = name.normalize("NFC").toLocaleLowerCase("en-US");
      if (names.has(candidateKey)) continue;
      names.add(candidateKey);
      return { ...entry, name };
    }
    throw new Error("条目名称冲突过多，无法安全导出。");
  });
  const title =
    input.targetType === "library"
      ? selected[0]!.title
      : groups.find((group) => group.id === input.targetId)!.title;
  return {
    fileName: `${safeMarkdownName(title)}.zip`,
    entries
  };
}

export async function readLibraryMarkdownZip(path: string): Promise<{
  candidates: Array<{ sourceName: string; title: string; content: string }>;
  scanned: number;
  skippedEmpty: number;
  skippedLimitExceeded: number;
}> {
  const archive = await openLegacyZipArchive(path, "Markdown 库压缩包");
  const candidates: Array<{
    sourceName: string;
    title: string;
    content: string;
  }> = [];
  let totalBytes = 0;
  let scanned = 0;
  let skippedEmpty = 0;
  let skippedLimitExceeded = 0;
  for (const name of archive.entryNames) {
    if (!/\.(?:md|markdown|txt)$/iu.test(name)) continue;
    scanned += 1;
    if (candidates.length >= CATALOG_PROJECT_MAX_CONTENT_ITEMS) {
      skippedLimitExceeded += 1;
      continue;
    }
    const bytes = archive.read(name);
    if (!bytes) continue;
    totalBytes += bytes.length;
    if (totalBytes > 32 * 1024 * 1024) {
      throw new LibraryMarkdownArchiveTooLargeError(
        "Markdown 压缩包提取内容超过 32 MB 安全上限。"
      );
    }
    const content = bytes.toString("utf8").replace(/^\uFEFF/u, "");
    if (!content.trim()) {
      skippedEmpty += 1;
      continue;
    }
    const sourceName = basename(name);
    candidates.push({
      sourceName,
      title: sourceName.replace(/\.(?:md|markdown|txt)$/iu, "") || "未命名条目",
      content
    });
  }
  return { candidates, scanned, skippedEmpty, skippedLimitExceeded };
}

export async function writeLibraryMarkdownZip(
  path: string,
  entries: readonly { name: string; data: Buffer }[]
): Promise<void> {
  await writeFile(path, createZip(entries));
}
