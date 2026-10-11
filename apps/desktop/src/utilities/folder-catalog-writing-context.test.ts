import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SCRIPT_WRITING_CONTEXT,
  DEFAULT_SHORT_WRITING_CONTEXT,
  WRITING_CONTEXT_MAX_CHARACTERS
} from "@deepwrite/contracts";
import { FolderCatalogStore } from "./folder-catalog-store";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-writing-context-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("FolderCatalogStore writing context", () => {
  it("initializes distinct AGENTS.md defaults for new short and script books", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const short = await store.createShortBook(
      { title: "短篇测试", genre: "悬疑" },
      join(root, "books")
    );
    const script = await store.createScriptBook(
      { title: "剧本测试", genre: "其他" },
      join(root, "books")
    );

    await expect(
      readFile(join(short.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SHORT_WRITING_CONTEXT);
    await expect(
      readFile(join(script.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SCRIPT_WRITING_CONTEXT);
    await expect(
      store.readWritingContext({ bookId: short.resource.id })
    ).resolves.toMatchObject({
      workspaceType: "short",
      content: DEFAULT_SHORT_WRITING_CONTEXT,
      truncated: false
    });
    await expect(
      store.readWritingContext({ bookId: script.resource.id })
    ).resolves.toMatchObject({
      workspaceType: "script",
      content: DEFAULT_SCRIPT_WRITING_CONTEXT,
      truncated: false
    });
  });

  it("saves custom context and lazily repairs a missing legacy file", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const book = await store.createShortBook(
      { title: "旧短篇", genre: "其他" },
      join(root, "books")
    );
    const custom = "# 我的短篇上下文\n\n结尾必须回收开场意象。\n";

    await expect(
      store.writeWritingContext({ bookId: book.resource.id, content: custom })
    ).resolves.toMatchObject({ workspaceType: "short" });
    await expect(
      store.readWritingContext({ bookId: book.resource.id })
    ).resolves.toMatchObject({ content: custom });

    await unlink(join(book.projectDirectory, "AGENTS.md"));
    await expect(
      store.readWritingContext({ bookId: book.resource.id })
    ).resolves.toMatchObject({ content: DEFAULT_SHORT_WRITING_CONTEXT });
    await expect(
      readFile(join(book.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SHORT_WRITING_CONTEXT);
  });

  it("rejects writes above the code-point limit", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const book = await store.createScriptBook(
      { title: "超限剧本", genre: "其他" },
      join(root, "books")
    );
    await expect(
      store.writeWritingContext({
        bookId: book.resource.id,
        content: "界".repeat(WRITING_CONTEXT_MAX_CHARACTERS + 1)
      })
    ).rejects.toThrow();
  });

  it("copies customized context with a duplicated book", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const source = await store.createScriptBook(
      { title: "原剧本", genre: "其他" },
      join(root, "books")
    );
    const custom = "# 剧本上下文\n\n每集结尾留下一个可见行动悬念。\n";
    await store.writeWritingContext({
      bookId: source.resource.id,
      content: custom
    });
    const copy = await store.duplicateProject({
      domain: "book",
      projectId: source.resource.id
    });
    await expect(
      store.readWritingContext({ bookId: copy.projectId })
    ).resolves.toMatchObject({ workspaceType: "script", content: custom });
  });
});
