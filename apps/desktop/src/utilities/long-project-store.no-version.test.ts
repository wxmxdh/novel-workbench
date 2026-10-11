import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectStore } from "./long-project-store";
import { migrateLegacyLongVersionMetadata } from "./long-project-store/migrations/version-metadata";

const roots: string[] = [];

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-no-long-version-"));
  roots.push(root);
  await mkdir(join(root, "long", "ledger"), { recursive: true });
  return await realpath(root);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("long project direct-edit storage", () => {
  it("creates and edits a project without persisting business revisions", async () => {
    const parent = await projectRoot();
    const store = new LongProjectStore({
      now: () => "2026-08-29T00:00:00.000Z"
    });
    const created = await store.createBook(parent, {
      id: "longbook_direct-edit",
      title: "直接编辑",
      genre: "悬疑"
    });
    const fileId = created.book.workspaceIndex.bookLine.id;

    await store.writeDocument(created.projectDirectory, {
      fileId,
      content: "第一次保存"
    });
    await store.writeDocument(created.projectDirectory, {
      fileId,
      content: "第二次保存"
    });

    await expect(
      store.readDocument(created.projectDirectory, { fileId })
    ).resolves.toMatchObject({ content: "第二次保存" });
    const manifest = await readFile(
      join(created.projectDirectory, "deepwrite.json"),
      "utf8"
    );
    const index = await readFile(
      join(created.projectDirectory, "long", "index.json"),
      "utf8"
    );
    expect(`${manifest}\n${index}`).not.toMatch(
      /"(?:revision|[^"\n]*Revision|reversible)"/u
    );
  });

  it("strips legacy revision and rollback metadata while preserving schemaVersion", async () => {
    const root = await projectRoot();
    const rawManifest = {
      schemaVersion: 1,
      revision: 9,
      workspaceIndexFile: {
        path: "long/index.json",
        revision: "v2:0:legacy",
        updatedAt: "2026-08-29T00:00:00.000Z"
      }
    };
    const rawIndex = {
      schemaVersion: 1,
      revision: 9,
      bookId: "longbook_legacy",
      ledger: {
        commits: [
          {
            id: "commit_legacy",
            reversible: true,
            sourceRevision: 8,
            recordFile: {
              path: "long/ledger/legacy.json",
              revision: "v2:0:legacy"
            }
          }
        ]
      }
    };
    const rawRecord = {
      schemaVersion: 4,
      id: "commit_legacy",
      reversible: true,
      sourceWorkspaceRevision: 8,
      committedWorkspaceRevision: 9,
      previousChapterCommitId: "commit_previous",
      placementChanges: [
        {
          placementId: "placement_legacy",
          before: { status: "planned", commitId: null },
          after: { status: "committed", commitId: "commit_legacy" }
        }
      ],
      fileChanges: [{ before: { revision: "v2:0:legacy", content: "旧" } }]
    };
    await writeFile(
      join(root, "deepwrite.json"),
      JSON.stringify(rawManifest),
      "utf8"
    );
    await writeFile(
      join(root, "long", "index.json"),
      JSON.stringify(rawIndex),
      "utf8"
    );
    await writeFile(
      join(root, "long", "ledger", "legacy.json"),
      JSON.stringify(rawRecord),
      "utf8"
    );

    await expect(
      migrateLegacyLongVersionMetadata({
        projectDirectory: root,
        rawManifest,
        rawIndex
      })
    ).resolves.toBe(true);

    const manifest = JSON.parse(
      await readFile(join(root, "deepwrite.json"), "utf8")
    ) as Record<string, unknown>;
    const index = JSON.parse(
      await readFile(join(root, "long", "index.json"), "utf8")
    ) as Record<string, unknown>;
    const record = JSON.parse(
      await readFile(join(root, "long", "ledger", "legacy.json"), "utf8")
    ) as Record<string, unknown>;
    expect(manifest.schemaVersion).toBe(1);
    expect(index.schemaVersion).toBe(1);
    expect(record.schemaVersion).toBe(4);
    expect(JSON.stringify({ manifest, index, record })).not.toMatch(
      /revision|reversible|fileChanges|"before"/iu
    );
  });
});
