import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CatalogIndexSnapshotSchema,
  CatalogLibraryEntrySchema,
  CatalogLibrarySchema,
  CatalogReadDocumentResultSchema,
  CommandEnvelopeSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FolderCatalogStore } from "../utilities/folder-catalog-store";
import {
  bootstrapShuorenhuaSkillLibrary,
  shuorenhuaSkillLibraryContent
} from "./shuorenhua-skill-library-bootstrap";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function temporaryPath(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

/** Route validated bootstrap envelopes through real catalog-store operations. */
function coreCatalogBridge(store: FolderCatalogStore) {
  return async (raw: CommandEnvelope): Promise<CommandResult> => {
    const command = CommandEnvelopeSchema.parse(raw);
    switch (command.type) {
      case "catalog.index":
        return {
          status: "accepted",
          requestId: command.id,
          payload: CatalogIndexSnapshotSchema.parse(
            await store.indexSnapshot()
          )
        };
      case "catalog.readDocument":
        return {
          status: "accepted",
          requestId: command.id,
          payload: CatalogReadDocumentResultSchema.parse(
            await store.readDocument(command.payload)
          )
        };
      case "catalog.createLibraryAtPath": {
        const created = await store.createLibrary(command.payload);
        return {
          status: "accepted",
          requestId: command.id,
          payload: CatalogLibrarySchema.parse(created.resource)
        };
      }
      case "catalog.updateLibrary":
        return {
          status: "accepted",
          requestId: command.id,
          payload: CatalogLibrarySchema.parse(
            await store.updateLibrary(command.payload)
          )
        };
      case "catalog.createLibraryEntry":
        return {
          status: "accepted",
          requestId: command.id,
          payload: CatalogLibraryEntrySchema.parse(
            await store.createLibraryEntry(command.payload)
          )
        };
      default:
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "test.unexpected-command",
            message: `Unexpected Core command: ${command.type}`
          }
        };
    }
  };
}

describe("Shuorenhua native skill library bootstrap integration", () => {
  it("creates through catalog commands when workspace/skills is absent and survives restart idempotently", async () => {
    const root = await temporaryPath("deepwrite-shuorenhua-core-");
    const workspace = join(root, "workspace");
    const userDataPath = join(root, "profile");
    const firstStore = new FolderCatalogStore({ userDataPath });

    const installed = await bootstrapShuorenhuaSkillLibrary({
      workspaceDirectory: workspace,
      content: shuorenhuaSkillLibraryContent,
      requestCore: coreCatalogBridge(firstStore)
    });

    expect(installed.status).toBe("installed");
    expect(installed.libraryId).toBeTruthy();
    expect((await stat(join(workspace, "skills"))).isDirectory()).toBe(true);
    const firstIndex = await firstStore.indexSnapshot();
    const firstLibrary = firstIndex.skills.find(
      (item) => item.title === "中文表达审核"
    );
    expect(firstLibrary?.entries).toHaveLength(1);
    const original = await firstStore.readDocument({
      projectId: firstLibrary!.id,
      target: "document",
      documentId: firstLibrary!.entries[0]!.id
    });
    expect(original.content).toBe(shuorenhuaSkillLibraryContent);

    const restartedStore = new FolderCatalogStore({ userDataPath });
    const restarted = await bootstrapShuorenhuaSkillLibrary({
      workspaceDirectory: workspace,
      content: shuorenhuaSkillLibraryContent,
      requestCore: coreCatalogBridge(restartedStore)
    });
    expect(restarted).toMatchObject({
      status: "already-installed",
      libraryId: installed.libraryId
    });
    expect(
      (await restartedStore.indexSnapshot()).skills.find(
        (item) => item.id === installed.libraryId
      )?.entries
    ).toHaveLength(1);
  });

  it("does not replace an author-edited native entry", async () => {
    const root = await temporaryPath("deepwrite-shuorenhua-edited-");
    const workspace = join(root, "workspace");
    const userDataPath = join(root, "profile");
    const store = new FolderCatalogStore({ userDataPath });
    const bridge = coreCatalogBridge(store);
    const installed = await bootstrapShuorenhuaSkillLibrary({
      workspaceDirectory: workspace,
      content: shuorenhuaSkillLibraryContent,
      requestCore: bridge
    });
    const library = (await store.indexSnapshot()).skills.find(
      (item) => item.id === installed.libraryId
    )!;
    const entry = library.entries[0]!;
    const current = await store.readDocument({
      projectId: library.id,
      target: "document",
      documentId: entry.id
    });
    const authoredContent = `${current.content}\n\n作者补充。\n`;
    await store.saveLibraryEntry({
      domain: "skill",
      libraryId: library.id,
      entryId: entry.id,
      title: entry.title,
      content: authoredContent,
      baseRevision: current.revision,
      baseProjectRevision: current.projectRevision
    });

    const afterRestart = new FolderCatalogStore({ userDataPath });
    const result = await bootstrapShuorenhuaSkillLibrary({
      workspaceDirectory: workspace,
      content: shuorenhuaSkillLibraryContent,
      requestCore: coreCatalogBridge(afterRestart)
    });
    expect(result).toMatchObject({
      status: "skipped",
      reason: "entry-edited",
      libraryId: library.id
    });
    const preserved = await afterRestart.readDocument({
      projectId: library.id,
      target: "document",
      documentId: entry.id
    });
    expect(preserved.content).toBe(authoredContent);
    expect(
      (await afterRestart.indexSnapshot()).skills.find(
        (item) => item.id === library.id
      )?.entries
    ).toHaveLength(1);
  });
});
