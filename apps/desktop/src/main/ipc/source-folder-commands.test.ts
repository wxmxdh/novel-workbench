import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  LongSourceFolderPreviewSchema,
  type LongSourceFolderPreview
} from "@deepwrite/contracts";
const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showOpenDialog } }));
import {
  handleSourceFolderCommands,
  clearSourceFolderPreviews
} from "./source-folder-commands";
import { LongProjectStore } from "../../utilities/long-project-store";
const roots: string[] = [];
afterEach(async () => {
  clearSourceFolderPreviews(42);
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
  vi.clearAllMocks();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-folder-ipc-"));
  roots.push(root);
  const sources = await mkdtemp(join(tmpdir(), "deepwrite-folder-originals-"));
  roots.push(sources);
  await writeFile(join(sources, "人物.md"), "\uFEFF# 原稿\r\n候选  \r\n");
  await writeFile(join(sources, "另一份.md"), "另一份资料");
  const store = new LongProjectStore();
  const { book, projectDirectory } = await store.createBook(root, {
    id: "longbook_folder-ipc",
    title: "合成书",
    genre: "其他"
  });
  const requestCommand = vi.fn(
    async (
      _worker: string,
      command: ReturnType<typeof CommandEnvelopeSchema.parse>
    ) => {
      let payload: unknown;
      switch (command.type) {
        case "long.getWorkspaceIndex":
          payload = {
            bookId: book.id,
            workspaceIndex: (await store.openBook(projectDirectory)).book
              .workspaceIndex
          };
          break;
        case "long.importSource":
          payload = await store.importSource(projectDirectory, command.payload);
          break;
        case "long.connectSourceFolderAtPath": {
          const { bookId, ...folder } = command.payload;
          payload = await store.updateSourceFolder(projectDirectory, {
            bookId,
            folder
          });
          break;
        }
        default:
          throw new Error(`Unexpected ${command.type}`);
      }
      return { status: "accepted" as const, requestId: command.id, payload };
    }
  );
  const ctx = {
    owner: 42,
    window: null,
    supervisor: { requestCommand } as Parameters<
      typeof handleSourceFolderCommands
    >[0]["supervisor"]
  };
  const invoke = (type: string, payload: unknown, owner = 42) =>
    handleSourceFolderCommands(
      { ...ctx, owner },
      CommandEnvelopeSchema.parse(
        createEnvelope(type, payload, { id: crypto.randomUUID() })
      )
    );
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sources] });
  const result = await invoke("long.chooseSourceFolder", { bookId: book.id });
  expect(result?.status).toBe("accepted");
  const preview = LongSourceFolderPreviewSchema.parse(
    result?.status === "accepted" ? result.payload : null
  );
  const confirm = (
    preview: LongSourceFolderPreview,
    owner = 42,
    mode = "copy"
  ) =>
    invoke(
      "long.confirmSourceFolder",
      {
        bookId: book.id,
        previewId: preview.previewId,
        mode,
        fileIds: preview.files.map((file) => file.id),
        purpose: "character",
        authority: "reference"
      },
      owner
    );
  return {
    store,
    book,
    projectDirectory,
    sources,
    invoke,
    preview,
    confirm,
    requestCommand
  };
}
describe("folder source IPC author preview", () => {
  it("uses the path hint only for the chooser, not the Core book command", async () => {
    const f = await fixture();
    await f.invoke("long.chooseSourceFolder", {
      bookId: f.book.id,
      suggestedPath: join(f.sources, "人物.md")
    });
    expect(showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: f.sources })
    );
    const reads = f.requestCommand.mock.calls.filter(
      ([, command]) => command.type === "long.getWorkspaceIndex"
    );
    expect(reads.at(-1)?.[1].payload).toEqual({ bookId: f.book.id });
  });
  it("keeps partial copies retryable without duplicating the successful file", async () => {
    const f = await fixture();
    const original = f.requestCommand.getMockImplementation()!;
    let writes = 0;
    f.requestCommand.mockImplementation(async (...args) => {
      if (args[1].type === "long.importSource" && ++writes === 2)
        throw new Error("synthetic transient failure");
      return original(...args);
    });
    const partial = await f.confirm(f.preview);
    expect(partial?.status === "accepted" && partial.payload).toMatchObject({
      imported: 1,
      failures: [{ reason: "synthetic transient failure" }]
    });
    const retry = await f.confirm(f.preview);
    expect(retry?.status === "accepted" && retry.payload).toMatchObject({
      imported: 1,
      duplicates: 1,
      failures: []
    });
    expect(
      (await f.store.openBook(f.projectDirectory)).book.workspaceIndex
        .importedSources
    ).toHaveLength(2);
  });
  it("rejects another window, preserves original bytes and skips exact duplicate copies", async () => {
    const f = await fixture();
    expect((await f.confirm(f.preview, 43))?.status).toBe("rejected");
    expect(
      f.requestCommand.mock.calls.filter(
        ([, command]) => command.type === "long.importSource"
      )
    ).toHaveLength(0);
    const imported = await f.confirm(f.preview);
    expect(imported?.status).toBe("accepted");
    expect(
      imported?.status === "accepted" ? imported.payload : imported
    ).toMatchObject({ imported: 2, failures: [] });
    const index = (await f.store.openBook(f.projectDirectory)).book
      .workspaceIndex;
    expect(index.importedSources).toHaveLength(2);
    const source = index.importedSources.find(
      (item) => item.sourceName === "人物.md"
    )!;
    expect(
      (
        await f.store.readDocument(f.projectDirectory, {
          fileId: source.file.id,
          offset: 0,
          limit: 1000
        })
      ).content
    ).toBe("\uFEFF# 原稿\r\n候选  \r\n");
    const again = await f.invoke("long.chooseSourceFolder", {
      bookId: f.book.id
    });
    const fresh = LongSourceFolderPreviewSchema.parse(
      again?.status === "accepted" ? again.payload : null
    );
    const duplicate = await f.confirm(fresh);
    expect(duplicate?.status === "accepted" && duplicate.payload).toMatchObject(
      { imported: 0, duplicates: 2 }
    );
  });
  it("rejects changed files before any write and rejects a consumed preview", async () => {
    const f = await fixture();
    await writeFile(join(f.sources, "人物.md"), "changed after preview");
    expect((await f.confirm(f.preview))?.status).toBe("rejected");
    expect(
      (await f.store.openBook(f.projectDirectory)).book.workspaceIndex
        .importedSources
    ).toHaveLength(0);
    const again = await f.invoke("long.chooseSourceFolder", {
      bookId: f.book.id
    });
    const fresh = LongSourceFolderPreviewSchema.parse(
      again?.status === "accepted" ? again.payload : null
    );
    expect((await f.confirm(fresh, 42, "connect"))?.status).toBe("accepted");
    expect((await f.confirm(fresh, 42, "connect"))?.status).toBe("rejected");
    const index = (await f.store.openBook(f.projectDirectory)).book
      .workspaceIndex;
    expect(index.sourceFolders[0]?.allowedFileIds).toEqual(
      fresh.files.map((file) => file.id)
    );
  });
});
