import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEmptyLongMarkdownFileReference,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longCharacterRelationshipsFileId
} from "@deepwrite/contracts";
import {
  LongProjectStore,
  type LongProjectSearchResume
} from "./long-project-store";
import { LongWorkspaceService } from "./long-workspace-service";

const FIXED_NOW = "2026-07-26T12:00:00.000Z";
const temporaryRoots: string[] = [];

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("LongProjectStore resumable search", () => {
  it("searches a single document larger than the former 8 MiB batch limit", async () => {
    const root = await temporaryRoot("deepwrite-long-large-search-");
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const created = await store.createBook(root, {
      id: "longbook_large-search",
      title: "大型搜索",
      genre: "其他"
    });
    const body = created.book.workspaceIndex.chapters[0]!.body;
    const content = `${"a".repeat(8 * 1024 * 1024 + 1)}Needle`;
    await store.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content
    });

    let resume: LongProjectSearchResume | undefined;
    let pageCount = 0;
    let found:
      | Awaited<ReturnType<LongProjectStore["search"]>>["matches"][number]
      | undefined;
    do {
      const page = await store.search(created.projectDirectory, {
        query: "needle",
        fileIds: [body.id],
        maxResults: 10,
        ...(resume ? { resume } : {})
      });
      pageCount += 1;
      found ??= page.matches[0];
      resume = page.nextResume ?? undefined;
    } while (resume);

    expect(pageCount).toBeGreaterThan(1);
    expect(found).toMatchObject({
      fileId: body.id,
      offset: 8 * 1024 * 1024 + 1,
      endOffset: 8 * 1024 * 1024 + 7
    });
  });

  it("uses Unicode code-point offsets and NFC-equivalent matching", async () => {
    const root = await temporaryRoot("deepwrite-long-unicode-search-");
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const created = await store.createBook(root, {
      id: "longbook_unicode-search",
      title: "Unicode 搜索",
      genre: "其他"
    });
    const body = created.book.workspaceIndex.chapters[0]!.body;
    await store.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "😀Cafe\u0301 之后"
    });

    const page = await store.search(created.projectDirectory, {
      query: "Café",
      fileIds: [body.id],
      maxResults: 10
    });
    expect(page.matches).toEqual([
      expect.objectContaining({
        fileId: body.id,
        offset: 1,
        endOffset: 6,
        preview: "😀Cafe\u0301 之后"
      })
    ]);
  });

  it("resumes by file and character without losing more than 100 hits", async () => {
    const root = await temporaryRoot("deepwrite-long-resume-search-");
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const created = await store.createBook(root, {
      id: "longbook_resume-search",
      title: "游标搜索",
      genre: "其他"
    });
    const body = created.book.workspaceIndex.chapters[0]!.body;
    await store.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "hit ".repeat(250)
    });

    const offsets: number[] = [];
    const pageSizes: number[] = [];
    let resume: LongProjectSearchResume | undefined;
    do {
      const page = await store.search(created.projectDirectory, {
        query: "hit",
        fileIds: [body.id],
        maxResults: 100,
        ...(resume ? { resume } : {})
      });
      offsets.push(...page.matches.map(({ offset }) => offset));
      pageSizes.push(page.matches.length);
      resume = page.nextResume ?? undefined;
    } while (resume);

    expect(pageSizes).toEqual([100, 100, 50]);
    expect(offsets).toHaveLength(250);
    expect(offsets).toEqual(
      Array.from({ length: 250 }, (_, index) => index * 4)
    );
  });

  it("resumes from its character offset after the current file changes", async () => {
    const root = await temporaryRoot("deepwrite-long-stale-search-");
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const created = await store.createBook(root, {
      id: "longbook_stale-search",
      title: "失效游标",
      genre: "其他"
    });
    const body = created.book.workspaceIndex.chapters[0]!.body;
    await store.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "hit hit"
    });
    const firstPage = await store.search(created.projectDirectory, {
      query: "hit",
      fileIds: [body.id],
      maxResults: 1
    });
    expect(firstPage.nextResume).not.toBeNull();

    await store.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "hit changed"
    });

    await expect(
      store.search(created.projectDirectory, {
        query: "hit",
        fileIds: [body.id],
        maxResults: 1,
        resume: firstPage.nextResume!
      })
    ).resolves.toMatchObject({ matches: [] });
  });
});

describe("LongWorkspaceService opaque search cursor", () => {
  it("paginates every hit in one file and binds the cursor to its query", async () => {
    const root = await temporaryRoot("deepwrite-long-service-search-");
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => FIXED_NOW
    });
    const created = await service.create(root, {
      title: "分页搜索",
      genre: "其他"
    });
    const chapter = created.book.workspaceIndex.chapters[0]!;
    await service.writeDocument({
      bookId: created.book.id,
      fileId: chapter.body.id,
      content: "needle ".repeat(235)
    });

    const offsets: number[] = [];
    let cursor: string | undefined;
    let firstCursor: string | undefined;
    do {
      const page = await service.search({
        bookId: created.book.id,
        query: "needle",
        scope: "draft",
        limit: 37,
        maxSnippetCharacters: 80,
        ...(cursor ? { cursor } : {})
      });
      offsets.push(...page.hits.map(({ start }) => start));
      cursor = page.nextCursor ?? undefined;
      firstCursor ??= cursor;
      if (cursor) expect(cursor).toMatch(/^v1\.[A-Za-z0-9_-]+$/u);
    } while (cursor);

    expect(offsets).toHaveLength(235);
    expect(new Set(offsets).size).toBe(235);
    expect(offsets).toEqual(
      Array.from({ length: 235 }, (_, index) => index * 7)
    );
    await expect(
      service.search({
        bookId: created.book.id,
        query: "other",
        scope: "draft",
        cursor: firstCursor!,
        limit: 10,
        maxSnippetCharacters: 80
      })
    ).rejects.toThrow(/游标/u);

    await service.writeDocument({
      bookId: created.book.id,
      fileId: chapter.body.id,
      content: "内容发生变化"
    });
    await expect(
      service.search({
        bookId: created.book.id,
        query: "needle",
        scope: "draft",
        cursor: firstCursor!,
        limit: 10,
        maxSnippetCharacters: 80
      })
    ).resolves.toMatchObject({ hits: [] });
  });

  it("resumes across more than 500 authorized files and finds a later hit", async () => {
    const root = await temporaryRoot("deepwrite-long-many-file-search-");
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => FIXED_NOW
    });
    const created = await service.create(root, {
      title: "多文件搜索",
      genre: "其他"
    });
    const chapterCardId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    const operations = Array.from({ length: 130 }, (_, index) => {
      const characterId = `character_search-${index + 1}`;
      const reference = (
        id: string,
        filename: Parameters<typeof longCharacterFilePath>[1]
      ) =>
        createEmptyLongMarkdownFileReference(
          id,
          longCharacterFilePath(characterId, filename),
          FIXED_NOW
        );
      return [
        {
          type: "character.create" as const,
          character: {
            id: characterId,
            name: `人物${index + 1}`,
            group: "major_supporting" as const,
            order: index + 1,
            aliases: []
          },
          files: {
            characterId,
            coreProfile: reference(
              longCharacterCoreProfileFileId(characterId),
              "core-profile.md"
            ),
            relationships: reference(
              longCharacterRelationshipsFileId(characterId),
              "relationships.md"
            )
          }
        },
        {
          type: "chapterContinuity.character.create" as const,
          chapterCardId,
          characterId,
          currentState: createEmptyLongMarkdownFileReference(
            longChapterCharacterCurrentStateFileId(chapterCardId, characterId),
            longChapterCharacterContinuityFilePath(
              chapterCardId,
              characterId,
              "current-state.md"
            ),
            FIXED_NOW
          ),
          history: createEmptyLongMarkdownFileReference(
            longChapterCharacterHistoryFileId(chapterCardId, characterId),
            longChapterCharacterContinuityFilePath(
              chapterCardId,
              characterId,
              "history.md"
            ),
            FIXED_NOW
          )
        }
      ];
    }).flat();
    await service.applyOperations({
      bookId: created.book.id,
      batch: {
        updatedAt: FIXED_NOW,
        operations,
        documentWrites: []
      }
    });
    const opened = await service.open({ bookId: created.book.id });
    const lastHistory =
      opened.book.workspaceIndex.chapters[0]!.characterContinuity.at(
        -1
      )!.history;
    await service.writeDocument({
      bookId: created.book.id,
      fileId: lastHistory.id,
      content: "第 520 个角色文件中的 needle"
    });

    let cursor: string | undefined;
    let searchPages = 0;
    const hits: Awaited<ReturnType<typeof service.search>>["hits"] = [];
    do {
      const page = await service.search({
        bookId: created.book.id,
        query: "needle",
        scope: "all",
        limit: 20,
        maxSnippetCharacters: 80,
        ...(cursor ? { cursor } : {})
      });
      searchPages += 1;
      hits.push(...page.hits);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(searchPages).toBeGreaterThan(4);
    expect(hits).toEqual([
      expect.objectContaining({
        fileId: lastHistory.id,
        root: "continuity_ledger",
        title: expect.stringContaining("人物130 · 历史轨迹")
      })
    ]);
    await expect(
      service.search({
        bookId: created.book.id,
        query: "needle",
        scope: "draft",
        limit: 20,
        maxSnippetCharacters: 80
      })
    ).resolves.toMatchObject({ hits: [], nextCursor: null });
  }, 60_000);
});
