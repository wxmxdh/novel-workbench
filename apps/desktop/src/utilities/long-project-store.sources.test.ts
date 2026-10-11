import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectStore } from "./long-project-store";
import { listSourceFolder } from "./source-folder-reader";

const roots: string[] = [];
const now = "2026-10-03T12:00:00.000Z";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-source-import-"));
  roots.push(root);
  const store = new LongProjectStore({ now: () => now });
  const created = await store.createBook(root, {
    id: "longbook_source-test",
    title: "测试书",
    genre: "其他"
  });
  return { root, store, created };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("LongProjectStore: imported sources", () => {
  it("reads the latest content from an approved connected path but rejects a mid-query change", async () => {
    const { root, store, created } = await fixture();
    const sourceRoot = join(root, "connected-source");
    await mkdir(sourceRoot);
    const sourcePath = join(sourceRoot, "outline.md");
    await writeFile(sourcePath, "初次连接内容", "utf8");
    const initial = (await listSourceFolder(sourceRoot)).files[0]!;
    const connection = await store.updateSourceFolder(
      created.projectDirectory,
      {
        bookId: created.book.id,
        folder: {
          rootPath: sourceRoot,
          title: "作者资料",
          purpose: "outline",
          authority: "candidate",
          allowedFileIds: [initial.id]
        }
      }
    );
    const connected = connection.folder!;

    await writeFile(sourcePath, "作者更新后的资料", "utf8");
    const result = await store.querySourceFolder(created.projectDirectory, {
      bookId: created.book.id,
      sourceId: connected.id,
      fileId: initial.id
    });
    expect(result.document).toMatchObject({
      fileId: initial.id,
      content: "作者更新后的资料",
      sha256: createHash("sha256")
        .update("作者更新后的资料", "utf8")
        .digest("hex")
    });
  });

  it("preserves exact source text, exposes it to read/search/duplicate, and keeps it read-only", async () => {
    const { root, store, created } = await fixture();
    const content = "  # 外部总稿\r\n\r\n未确认的候选设定。\r\n";
    const imported = await store.importSource(created.projectDirectory, {
      bookId: created.book.id,
      title: "新书总稿",
      sourceName: "小说新项目完整接续总稿_v2.0.md",
      sourcePath: "E:/0浏览器下载文件/小说新项目完整接续总稿_v2.0.md",
      content,
      purpose: "foundation",
      authority: "candidate",
      expectedIndexUpdatedAt: created.book.workspaceIndex.updatedAt
    });

    expect(
      await readFile(
        join(created.projectDirectory, imported.source.file.path),
        "utf8"
      )
    ).toBe(content);
    expect(imported.source.sourceSha256).toBe(
      createHash("sha256").update(content, "utf8").digest("hex")
    );
    expect(imported.source.authority).toBe("candidate");
    await expect(
      store.importSource(created.projectDirectory, {
        bookId: created.book.id,
        title: "旧预览再次导入",
        sourceName: "old-preview.md",
        content: "不应第二次写入",
        purpose: "other",
        authority: "undecided",
        expectedIndexUpdatedAt: created.book.workspaceIndex.updatedAt
      })
    ).rejects.toThrow("已变化");

    const opened = await store.openBook(created.projectDirectory);
    expect(opened.book.workspaceIndex.importedSources).toHaveLength(1);
    const read = await store.readDocument(created.projectDirectory, {
      fileId: imported.source.file.id,
      offset: 0,
      limit: 1_000
    });
    expect(read.content).toBe(content);
    await expect(
      store.writeDocument(created.projectDirectory, {
        fileId: imported.source.file.id,
        content: "改写原始来源"
      })
    ).rejects.toThrow("只读");

    const search = await store.search(created.projectDirectory, {
      query: "未确认的候选设定",
      fileIds: [imported.source.file.id]
    });
    expect(search.matches).toHaveLength(1);

    const duplicate = await store.duplicateBook(
      root,
      created.projectDirectory,
      "副本"
    );
    const duplicateSource = duplicate.book.workspaceIndex.importedSources[0]!;
    expect(
      await readFile(
        join(duplicate.projectDirectory, duplicateSource.file.path),
        "utf8"
      )
    ).toBe(content);
  });

  it("rejects a stale preview index and UTF-8 payloads over 2 MiB", async () => {
    const { store, created } = await fixture();
    const base = {
      bookId: created.book.id,
      title: "导入资料",
      sourceName: "source.md",
      content: "正文",
      purpose: "outline" as const,
      authority: "undecided" as const,
      expectedIndexUpdatedAt: "2026-10-02T12:00:00.000Z"
    };
    await expect(
      store.importSource(created.projectDirectory, base)
    ).rejects.toThrow("已变化");
    await expect(
      store.importSource(created.projectDirectory, {
        ...base,
        content: "中".repeat(700_000),
        expectedIndexUpdatedAt: created.book.workspaceIndex.updatedAt
      })
    ).rejects.toThrow("2 MiB");
  });
});
