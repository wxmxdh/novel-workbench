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
import {
  LongProjectCatalog,
  type LongProjectAccess
} from "./long-project-catalog";
import { LongProjectStore } from "./long-project-store";

const NOW = "2026-08-29T10:00:00.000Z";
const temporaryRoots: string[] = [];

interface PersistedRegistry {
  schemaVersion: number;
  revision?: unknown;
  projects: Array<{
    summary?: {
      projectRevision?: unknown;
      navigation?: { revision?: unknown };
    };
  }>;
}

async function createFixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-long-catalog-version-"))
  );
  temporaryRoots.push(root);
  const store = new LongProjectStore({ now: () => NOW });
  const created = await store.createBook(root, {
    id: "longbook_catalog-version",
    title: "旧版长篇注册表",
    genre: "悬疑"
  });
  const userDataPath = join(root, "user-data");
  await mkdir(userDataPath);
  let openBookCalls = 0;
  const projects: LongProjectAccess = {
    async createBook() {
      return created;
    },
    async openBook(projectDirectory) {
      openBookCalls += 1;
      return {
        projectDirectory,
        ...(await store.openBook(projectDirectory))
      };
    },
    async inspectBook(projectDirectory) {
      return await store.inspectBookManifest(projectDirectory);
    }
  };
  const catalog = new LongProjectCatalog({
    userDataPath,
    projects,
    now: () => NOW
  });
  const legacyRegistry = {
    schemaVersion: 2,
    revision: 4,
    updatedAt: NOW,
    projects: [
      {
        bookId: created.summary.id,
        projectDirectory: created.projectDirectory,
        registeredAt: NOW,
        summary: {
          ...created.summary,
          projectRevision: 9,
          navigation: {
            ...created.summary.navigation,
            revision: 9
          }
        }
      }
    ]
  };

  async function writeLegacyRegistry(): Promise<void> {
    const content = `${JSON.stringify(legacyRegistry, null, 2)}\n`;
    await writeFile(catalog.registryPath, content, "utf8");
    await writeFile(catalog.registryBackupPath, content, "utf8");
  }

  async function expectCleanRegistryCopies(): Promise<void> {
    for (const path of [catalog.registryPath, catalog.registryBackupPath]) {
      const persisted = JSON.parse(
        await readFile(path, "utf8")
      ) as PersistedRegistry;
      expect(persisted.schemaVersion).toBe(2);
      expect(persisted).not.toHaveProperty("revision");
      expect(persisted.projects[0]?.summary).not.toHaveProperty(
        "projectRevision"
      );
      expect(persisted.projects[0]?.summary?.navigation).not.toHaveProperty(
        "revision"
      );
    }
  }

  return {
    catalog,
    created,
    expectCleanRegistryCopies,
    openBookCalls: () => openBookCalls,
    writeLegacyRegistry
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("LongProjectCatalog legacy version metadata", () => {
  it("lists a cached v2 summary after stripping and persisting retired revisions", async () => {
    const fixture = await createFixture();
    await fixture.writeLegacyRegistry();

    const listed = await fixture.catalog.list();

    expect(listed.books).toHaveLength(1);
    expect(listed.books[0]?.id).toBe(fixture.created.summary.id);
    expect(listed.books[0]).not.toHaveProperty("projectRevision");
    expect(listed.books[0]?.navigation).not.toHaveProperty("revision");
    expect(fixture.openBookCalls()).toBe(0);
    await fixture.expectCleanRegistryCopies();
  });

  it("opens directly from a cached v2 summary with retired revisions", async () => {
    const fixture = await createFixture();
    await fixture.writeLegacyRegistry();

    const opened = await fixture.catalog.open(fixture.created.summary.id);

    expect(opened.summary.id).toBe(fixture.created.summary.id);
    expect(fixture.openBookCalls()).toBe(1);
    await fixture.expectCleanRegistryCopies();
  });

  it("does not block a readable registry when a cleanup copy cannot be written", async () => {
    const fixture = await createFixture();
    await fixture.writeLegacyRegistry();
    await rm(fixture.catalog.registryBackupPath);
    await mkdir(fixture.catalog.registryBackupPath);

    await expect(fixture.catalog.list()).resolves.toMatchObject({
      books: [expect.objectContaining({ id: fixture.created.summary.id })]
    });
    expect(fixture.openBookCalls()).toBe(0);
    const primary = JSON.parse(
      await readFile(fixture.catalog.registryPath, "utf8")
    ) as PersistedRegistry;
    expect(primary).not.toHaveProperty("revision");
    expect(primary.projects[0]?.summary).not.toHaveProperty("projectRevision");
    expect(primary.projects[0]?.summary?.navigation).not.toHaveProperty(
      "revision"
    );
  });
});
