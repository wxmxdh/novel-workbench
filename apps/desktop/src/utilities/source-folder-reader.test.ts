import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readVerifiedSourceFolderFile,
  scanSourceFolder
} from "./source-folder-reader";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("source folder reads", () => {
  it("allows a connected path to expose updated content between queries and rejects changes within one query", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-source-folder-reader-")
    );
    roots.push(root);
    const path = join(root, "chapter.md");
    await writeFile(path, "初次预览内容", "utf8");

    const first = (await scanSourceFolder(root)).listing.files[0]!;
    await expect(
      readVerifiedSourceFolderFile(root, first)
    ).resolves.toMatchObject({ content: "初次预览内容" });

    await writeFile(path, "作者刚更新的内容", "utf8");
    await expect(readVerifiedSourceFolderFile(root, first)).rejects.toThrow(
      "本次读取期间已变化"
    );

    const refreshed = (
      await scanSourceFolder(root, { onlyFileIds: new Set([first.id]) })
    ).listing.files[0]!;
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.sha256).not.toBe(first.sha256);
    await expect(
      readVerifiedSourceFolderFile(root, refreshed)
    ).resolves.toMatchObject({ content: "作者刚更新的内容" });
  });

  it("caps bytes read by one scan and reports a truncated listing", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-source-folder-budget-")
    );
    roots.push(root);
    await writeFile(join(root, "a.md"), "a".repeat(10_000), "utf8");
    await writeFile(join(root, "b.md"), "b".repeat(10_000), "utf8");

    const scanned = await scanSourceFolder(root, { maxTotalBytes: 15_000 });
    expect(scanned.scannedBytes).toBe(10_000);
    expect(scanned.listing.files.map((file) => file.relativePath)).toEqual([
      "a.md"
    ]);
    expect(scanned.listing.limited).toBe(true);
  });
});
