import { afterEach, describe, expect, it } from "vitest";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { classifyOutlineSelection, readNovelChapterSources } from "./sources";

const baseSnapshot = {
  bookId: "book-a",
  bookLine: {
    id: "book-line",
    path: "00/主线.md",
    updatedAt: "2026-10-11T00:00:00.000Z"
  },
  chapters: [
    {
      chapterCardId: "chapter-a",
      card: {
        id: "chapter-card",
        path: "01/规划卡.md",
        updatedAt: "2026-10-11T00:00:00.000Z"
      },
      body: {
        id: "chapter-body",
        path: "01/正文.md",
        updatedAt: "2026-10-11T00:00:00.000Z"
      }
    }
  ],
  plot: {
    chapterCards: [{ id: "chapter-a" }]
  }
} as unknown as LongWorkspaceIndexSnapshot;

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

function documentPage(
  bookId: string,
  id: string,
  path: string,
  content: string,
  updatedAt = "2026-10-11T00:00:00.000Z"
) {
  return {
    bookId,
    file: { id, path, updatedAt },
    offset: 0,
    content,
    totalCharacters: content.length,
    nextOffset: null
  };
}

function installLongApi(
  snapshot = baseSnapshot,
  versions: Record<string, string> = {}
) {
  const getWorkspaceIndex = async ({ bookId }: { bookId: string }) => ({
    bookId,
    workspaceIndex: snapshot
  });
  const readDocument = async ({
    bookId,
    fileId
  }: {
    bookId: string;
    fileId: string;
  }) => {
    const files = [
      snapshot.bookLine,
      ...snapshot.chapters.flatMap((entry) => [entry.card, entry.body])
    ];
    const file = files.find((item) => item.id === fileId)!;
    return documentPage(
      bookId,
      file.id,
      file.path,
      fileId === "book-line"
        ? "作品主线"
        : fileId === "chapter-card"
          ? "规划内容"
          : "我不去。",
      versions[fileId] ?? file.updatedAt
    );
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { deepwrite: { long: { getWorkspaceIndex, readDocument } } }
  });
}

describe("classifyOutlineSelection", () => {
  it("keeps a generic planning card distinct from an author-selected outline", () => {
    expect(classifyOutlineSelection(undefined, "a".repeat(64))).toBe(
      "unselected"
    );
  });

  it("recognizes an explicitly selected matching version", () => {
    expect(
      classifyOutlineSelection(
        { sha256: "a".repeat(64), status: "current" },
        "a".repeat(64)
      )
    ).toBe("selected-current");
  });

  it("requires rechecking when the selected source version is stale", () => {
    expect(
      classifyOutlineSelection(
        { sha256: "a".repeat(64), status: "current" },
        "b".repeat(64)
      )
    ).toBe("selected-stale");
    expect(
      classifyOutlineSelection(
        { sha256: "a".repeat(64), status: "needs-recheck" },
        "a".repeat(64)
      )
    ).toBe("selected-stale");
  });
});

describe("readNovelChapterSources", () => {
  it("reads the book line, planning card, and draft with current version references", async () => {
    installLongApi();
    const result = await readNovelChapterSources(
      "book-a",
      "chapter-a",
      baseSnapshot
    );
    expect(result.sources.map(({ role }) => role)).toEqual([
      "bookLine",
      "outline",
      "draft"
    ]);
    expect(result.sources[1]?.outlineState).toBe("unselected");
    expect(result.warning).toContain("尚未明确选定大纲");
  });

  it("refreshes a stale caller snapshot before loading files", async () => {
    const currentSnapshot = structuredClone(baseSnapshot);
    currentSnapshot.chapters[0]!.body.updatedAt = "2026-10-11T00:05:00.000Z";
    installLongApi(currentSnapshot);
    const result = await readNovelChapterSources(
      "book-a",
      "chapter-a",
      baseSnapshot
    );
    expect(
      result.sources.find((source) => source.role === "draft")?.updatedAt
    ).toBe("2026-10-11T00:05:00.000Z");
  });

  it("rejects cross-book sources and files whose version changed while reading", async () => {
    installLongApi();
    await expect(
      readNovelChapterSources("book-b", "chapter-a", baseSnapshot)
    ).rejects.toThrow("不匹配");

    installLongApi(baseSnapshot, {
      "chapter-card": "2026-10-11T00:01:00.000Z"
    });
    await expect(
      readNovelChapterSources("book-a", "chapter-a", baseSnapshot)
    ).rejects.toThrow("发生变化");
  });
});
